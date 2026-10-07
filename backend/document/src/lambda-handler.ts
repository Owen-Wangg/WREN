/**
 * Document Service Lambda entry point — routes API Gateway events to service functions.
 * Adapter: API Gateway proxy events → backend/document service handlers.
 */
import type { APIGatewayProxyResult, Context } from 'aws-lambda';
import { freezeEventLoopOnReturn, getDataAccess, recordActivityEventRow } from '@wren/db-node';
import { S3Client, GetObjectCommand, DeleteObjectsCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuid } from 'uuid';
import { resolveAccess, bindCorsOrigin, withCorsHeaders, rejectIfForgedAuthContext } from '@wren/auth';
import type { AccessGrant, CustomMetadataField, TipTapDoc } from '@wren/types';
import {
  createDocumentInputSchema,
  isTipTapDoc,
  stripAiMarksFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
  charCountFromTipTapContent,
  findDisallowedTipTapNodeType,
  findUnsafeTipTapAttr,
  serializedTipTapBytes,
  TIPTAP_FIELD_MAX_BYTES,
} from '@wren/types';

import { clearOrphanUploadTag as clearOrphanUploadTagWithRetry } from './orphanUploadTag.js';
import { findUnreferencedUploadKeys } from './uploadKeyReferences.js';
import { MammothDocxExtractor } from './docxExtractor.js';
import { createPdfExtractor } from './ocrFactory.js';
import { resolveOcrEngine } from './textractOcr.js';
import { UnsupportedFileFormatError } from './errors.js';
import { ingestUpload } from './ingestion.js';
import { countWords, countChars } from './sizeLimit.js';
import { overSizeLimitHttpResponse } from './patchDraftSizeLimit.js';
import { gateSubmission } from './submissionGating.js';
import { validateDocumentMetadata } from './metadataGating.js';
import { createDraftRevision } from './draftVersioning.js';
import { DbDraftRepository } from './draftRepository.js';
import {
  enqueueIngestJob,
  getLatestIngestStatus,
  insertQueuedIngestJob,
  markIngestJobFailed,
  shouldIngestPdfAsync,
} from './ingestJob.js';
import {
  processIngestQueueMessage,
  type IngestQueueMessage,
} from './ingestWorker.js';
import {
  assertDocumentUploadAllowed,
  getPlatformUsagePolicy,
  reserveDraftCreate,
  reserveDocumentUpload,
  UsageLimitReachedError,
} from '@wren/admin/lifetimeUsagePolicy';

const docxExtractor = new MammothDocxExtractor();

function parseOcrEngineFromBody(body: { readonly ocrEngine?: unknown }): string {
  const raw = body.ocrEngine;
  return resolveOcrEngine(typeof raw === 'string' ? raw : null);
}

const withCors = withCorsHeaders;

function parseAuthContext(event: any) {
  const ctx = event.requestContext?.authorizer || {};
  return {
    userId: ctx.userId,
    idpSubject: ctx.idpSubject,
    email: ctx.email,
    roles: JSON.parse(ctx.roles || '[]'),
    administeredDepartmentIds: JSON.parse(ctx.administeredDepartmentIds || '[]'),
    grants: JSON.parse(ctx.grants || '[]'),
  };
}

/**
 * Every route served by the Document Lambda is a writer operation. Enforce the
 * Student role at runtime rather than relying on frontend routing or document
 * ownership alone. Mixed-role users remain eligible through their Student role.
 */
function studentAccessFailure(event: any): APIGatewayProxyResult | null {
  const actor = parseAuthContext(event);
  if (!actor.userId) {
    return {
      statusCode: 401,
      body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Authentication required' }),
    };
  }
  if (!actor.roles.includes('Student')) {
    return {
      statusCode: 403,
      body: JSON.stringify({ code: 'PERMISSION_DENIED', message: 'Student role required' }),
    };
  }
  return null;
}

async function wrapHandler(fn: () => Promise<APIGatewayProxyResult>): Promise<APIGatewayProxyResult> {
  try {
    return withCors(await fn());
  } catch (error: unknown) {
    console.error('Error:', error);
    if (error instanceof UsageLimitReachedError) {
      return withCors({
        statusCode: 429,
        body: JSON.stringify({ code: error.code, message: error.message }),
      });
    }

    if (error instanceof SyntaxError) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ code: 'BAD_REQUEST', message: 'Request body must be valid JSON' }),
      });
    }

    const candidateStatus =
      typeof error === 'object' && error !== null &&
      'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const statusCode =
      Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 600
        ? candidateStatus
        : 500;
    const code =
      statusCode === 403 ? 'PERMISSION_DENIED'
        : statusCode === 404 ? 'NOT_FOUND'
          : statusCode >= 500 ? 'INTERNAL_ERROR'
            : 'BAD_REQUEST';
    const safeMessage =
      statusCode < 500 && error instanceof Error
        ? error.message
        : 'Internal server error';

    return withCors({
      statusCode,
      body: JSON.stringify({ code, message: safeMessage }),
    });
  }
}

const DEFAULT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const ORPHAN_UPLOAD_TAGGING =
  '<Tagging><TagSet><Tag><Key>orphan-upload</Key><Value>true</Value></Tag></TagSet></Tagging>';

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ca-central-1' });

function canonicalUploadContentType(filename: string, contentType: string): string | null {
  const lower = filename.toLowerCase();
  const given = contentType.trim().toLowerCase();
  const unspecified = given === '' || given === 'application/octet-stream';
  if (lower.endsWith('.pdf')) {
    if (unspecified || given === 'application/pdf') return 'application/pdf';
    return null;
  }
  if (lower.endsWith('.docx')) {
    if (unspecified || given === DOCX_CONTENT_TYPE) return DOCX_CONTENT_TYPE;
    return null;
  }
  return null;
}

/**
 * Clear the `orphan-upload` tag on an attached upload so the retained original
 * survives the lifecycle rule. Fails closed on unrecoverable failure (see
 * `orphanUploadTag.ts` / finding S-2): a thrown `OrphanTagClearError` carries a
 * 500 and is mapped to `INTERNAL_ERROR` by `wrapHandler`, so no document row is
 * committed against an object S3 will delete within 24h.
 */
function clearOrphanUploadTag(key: string): Promise<void> {
  return clearOrphanUploadTagWithRetry(key, {
    client: s3Client,
    bucket: process.env.DOCUMENTS_BUCKET_NAME,
  });
}

/**
 * Re-apply the `orphan-upload=true` tag so the bucket lifecycle rule
 * (StorageResources.ts: 1-day expiry on this tag) reclaims the object.
 * Called on failed create/draft paths so a rejected upload key cannot be
 * replayed to force repeated paid OCR. Best-effort and non-fatal — a tagging
 * failure must never mask the underlying create error.
 *
 * The key is re-tagged only when no `draft` / `document_ingest_job` row
 * references it: a key already attached elsewhere must not be handed to the
 * lifecycle rule. If the reference check fails the tag is skipped (fail-safe
 * against data loss); the scheduled sweep (`orphanUploadSweep.ts`) re-tags any
 * key left untagged and unreferenced.
 *
 * Race with a concurrent request attaching the same key: references are
 * re-checked AFTER the tag write, and the tag is removed if the key is now
 * referenced. Together with the attach paths' post-commit clear
 * ({@link clearOrphanUploadTagAfterCommit}), any tag written here is either
 * removed by the winner's post-commit clear (tag landed first) or seen by this
 * re-check (winner committed first).
 */
async function tagOrphanUploadForExpiry(key: string): Promise<void> {
  const bucket = process.env.DOCUMENTS_BUCKET_NAME;
  if (!bucket) return;
  let db;
  try {
    db = await getDataAccess();
    const unreferenced = await findUnreferencedUploadKeys(db, [key]);
    if (unreferenced.length === 0) return;
  } catch (err) {
    console.warn('tagOrphanUploadForExpiry: reference check failed; leaving tag for sweep', err);
    return;
  }
  try {
    await s3Client.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: {
          TagSet: [{ Key: 'orphan-upload', Value: 'true' }],
        },
      }),
    );
  } catch (err) {
    console.warn('tagOrphanUploadForExpiry: non-fatal error', err);
    return;
  }
  let stillUnreferenced = true;
  try {
    stillUnreferenced = (await findUnreferencedUploadKeys(db, [key])).length > 0;
  } catch (err) {
    // Cannot prove the key is still unattached: undo the tag (fail-safe).
    console.warn('tagOrphanUploadForExpiry: post-tag reference check failed; removing tag', err);
    stillUnreferenced = false;
  }
  if (!stillUnreferenced) {
    await clearOrphanUploadTagAfterCommit(key);
  }
}

/**
 * Best-effort second clear after an attach transaction commits. The fail-closed
 * clear before the transaction remains the primary guarantee; this one removes
 * any tag a concurrent failing request wrote in between. A failure here is
 * logged (and `clearOrphanUploadTag` emits its failure metric) but does not
 * fail the already-committed request.
 */
async function clearOrphanUploadTagAfterCommit(key: string): Promise<void> {
  try {
    await clearOrphanUploadTag(key);
  } catch (err) {
    console.error('clearOrphanUploadTagAfterCommit: failed to clear orphan tag', { key, error: err });
  }
}

/** Format a DB timestamp as an ISO-8601 string with offset (matches `@wren/types`). */
function toIsoDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) {
    return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  }
  return new Date().toISOString();
}

/**
 * Normalize draft segments to the shared `{ index, text }` DTO.
 * Accepts legacy `{ paragraphIndex, text }` from older clients.
 */
function normalizeSegments(segments: unknown): Array<{ index: number; text: string }> {
  if (!Array.isArray(segments)) return [];
  return segments.map((raw, i) => {
    const seg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const index =
      typeof seg.index === 'number'
        ? seg.index
        : typeof seg.paragraphIndex === 'number'
          ? seg.paragraphIndex
          : i;
    return {
      index,
      text: typeof seg.text === 'string' ? seg.text : '',
    };
  });
}

/** Parse and sanitize optional TipTap `content` from a request body. */
function parseRequestTipTapContent(raw: unknown): TipTapDoc | undefined {
  if (!isTipTapDoc(raw)) return undefined;
  return stripAiMarksFromTipTapContent(raw) as TipTapDoc;
}

function rejectUnsafeTipTap(
  doc: TipTapDoc,
  field: string,
): APIGatewayProxyResult | null {
  const disallowed = findDisallowedTipTapNodeType(doc);
  if (disallowed) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: `Unsupported TipTap node type '${disallowed}' in ${field}`,
      }),
    };
  }
  // Node-type allowlisting does not constrain attribute values that the
  // client renderer interpolates into style/src (stored-XSS vector).
  const unsafeAttr = findUnsafeTipTapAttr(doc);
  if (unsafeAttr) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: `Unsupported TipTap attribute value '${unsafeAttr}' in ${field}`,
      }),
    };
  }
  if (serializedTipTapBytes(doc) > TIPTAP_FIELD_MAX_BYTES) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'PAYLOAD_TOO_LARGE',
        message: `${field} exceeds the ${Math.round(TIPTAP_FIELD_MAX_BYTES / 1_048_576)}MB serialized size limit`,
      }),
    };
  }
  return null;
}

/** Map a `document` row to the shared camelCase Document DTO. */
function toDocumentDto(row: any) {
  const metadata =
    typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata ?? {});
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    documentTypeId: row.document_type_id,
    contentTypeId: row.content_type_id,
    name: row.name,
    metadata,
    status: row.status,
    createdAt: toIsoDateTime(row.created_at),
  };
}

/**
 * Maintain the department `active_users` counter in `aggregate_counter`.
 * Called after document INSERT (delta=+1) and after document DELETE (delta=-1).
 *
 * Increment is conditional: only fires when the user has no OTHER document in
 * the same department (first document for that user in that dept).
 * Decrement is conditional: only fires when the user has NO remaining documents
 * in the same department after the deletion.
 *
 * Non-fatal — a counter drift is preferable to blocking the main operation.
 */
async function updateDepartmentUserCounter(
  documentTypeId: string,
  userId: string,
  documentId: string | null,
  delta: 1 | -1,
  db: Awaited<ReturnType<typeof getDataAccess>>,
): Promise<void> {
  try {
    if (delta === 1) {
      // Increment only if this is the user's first document in the department.
      await db.query(
        `INSERT INTO aggregate_counter (scope_kind, scope_id, metric, window_start, value)
         SELECT 'department', dt.department_id, 'active_users', '-infinity'::timestamptz, 1
         FROM document_type dt
         WHERE dt.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM document d2
             WHERE d2.owner_user_id = $2
               AND d2.document_type_id IN (
                   SELECT id FROM document_type WHERE department_id = dt.department_id
               )
               AND ($3::uuid IS NULL OR d2.id != $3)
           )
         ON CONFLICT (scope_kind, scope_id, metric, window_start)
         DO UPDATE SET value = aggregate_counter.value + EXCLUDED.value`,
        [documentTypeId, userId, documentId],
      );
    } else {
      // Decrement only if the user has no remaining documents in the department.
      // The document row is already deleted at this point.
      await db.query(
        `INSERT INTO aggregate_counter (scope_kind, scope_id, metric, window_start, value)
         SELECT 'department', dt.department_id, 'active_users', '-infinity'::timestamptz, -1
         FROM document_type dt
         WHERE dt.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM document d2
             WHERE d2.owner_user_id = $2
               AND d2.document_type_id IN (
                   SELECT id FROM document_type WHERE department_id = dt.department_id
               )
           )
         ON CONFLICT (scope_kind, scope_id, metric, window_start)
         DO UPDATE SET value = aggregate_counter.value + EXCLUDED.value`,
        [documentTypeId, userId],
      );
    }
  } catch (err) {
    console.warn('updateDepartmentUserCounter: non-fatal error', err);
  }
}

export const handler = async (
  event: any,
  context?: Context,
): Promise<APIGatewayProxyResult | void> => {
  freezeEventLoopOnReturn(context);
  // SQS async PDF ingest (Textract OCR) — not an API Gateway event.
  if (Array.isArray(event?.Records) && event.Records[0]?.eventSource === 'aws:sqs') {
    for (const record of event.Records) {
      const body = JSON.parse(record.body) as IngestQueueMessage;
      await processIngestQueueMessage(body, readS3ObjectBytes);
    }
    return;
  }

  bindCorsOrigin(event);
  try {
    // Reject forged/unsigned authorizer contexts (direct-invoke, finding f-140e2506).
    const forged = await rejectIfForgedAuthContext(event);
    if (forged) return withCors(forged);

    const { httpMethod, resource } = event;
    const accessFailure = studentAccessFailure(event);
    if (accessFailure) return withCors(accessFailure);

    if (resource === '/v1/documents' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListDocuments(event));
    }
    if (resource === '/v1/documents' && httpMethod === 'POST') {
      return await wrapHandler(() => handleCreateDocument(event));
    }
    if (resource === '/v1/documents/{documentId}' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetDocument(event));
    }
    if (resource === '/v1/documents/{documentId}' && httpMethod === 'DELETE') {
      return await wrapHandler(() => handleDeleteDocument(event));
    }
    if (resource === '/v1/documents/{documentId}/drafts' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetLatestDraft(event));
    }
    if (resource === '/v1/documents/{documentId}/drafts' && httpMethod === 'POST') {
      return await wrapHandler(() => handleCreateDraft(event));
    }
    if (resource === '/v1/documents/{documentId}/drafts/current' && httpMethod === 'PATCH') {
      return await wrapHandler(() => handlePatchCurrentDraft(event));
    }
    if (resource === '/v1/documents/{documentId}/ingest/status' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetIngestStatus(event));
    }
    if (resource === '/v1/uploads/presign' && httpMethod === 'POST') {
      return await wrapHandler(() => handlePresignUpload(event));
    }
    if (resource === '/v1/uploads/config' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetUploadConfig(event));
    }

    return withCors({
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    });
  } catch (error) {
    console.error('Unhandled error in Document Lambda:', error);
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    });
  }
};

async function handleListDocuments(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { limit = '20', offset = '0' } = event.queryStringParameters || {};

  const query = `
    SELECT id, owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at
    FROM document
    WHERE owner_user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const rows = await db.query(query, [actor.userId, parseInt(limit, 10), parseInt(offset, 10)]);
  const items = rows.map((row: any) => toDocumentDto(row));

  return {
    statusCode: 200,
    body: JSON.stringify({ items, total: items.length }),
  };
}

function normalizeGrants(raw: unknown): AccessGrant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (!g || typeof g !== 'object') return null;
      const row = g as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : null;
      const userId = typeof row.userId === 'string' ? row.userId : null;
      const documentTypeId =
        typeof row.documentTypeId === 'string' ? row.documentTypeId : null;
      const grantedBy = typeof row.grantedBy === 'string' ? row.grantedBy : '';
      const grantedAt =
        typeof row.grantedAt === 'string' ? row.grantedAt : new Date().toISOString();
      if (!id || !userId || !documentTypeId) return null;
      return {
        id,
        userId,
        documentTypeId,
        grantedBy,
        grantedAt,
        ...(typeof row.revokedAt === 'string' ? { revokedAt: row.revokedAt } : {}),
      } satisfies AccessGrant;
    })
    .filter((g): g is AccessGrant => g !== null);
}

/**
 * Reload the relevant active grant inside the Document service. The REST
 * authorizer also loads grants on every request, but this local query preserves
 * dual enforcement and prevents stale or forged authorizer context from
 * authorizing submission to a locked Department.
 */
async function loadActiveSubmissionGrants(
  userId: string,
  documentTypeId: string,
  db: Awaited<ReturnType<typeof getDataAccess>>,
): Promise<AccessGrant[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id,
            user_id AS "userId",
            document_type_id AS "documentTypeId",
            granted_by AS "grantedBy",
            granted_at::text AS "grantedAt"
     FROM access_grant
     WHERE user_id = $1
       AND document_type_id = $2
       AND revoked_at IS NULL`,
    [userId, documentTypeId],
  );
  return normalizeGrants(rows);
}

async function readS3ObjectBytes(key: string): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET_NAME!,
      Key: key,
    }),
  );
  if (!response.Body) {
    throw Object.assign(new Error('Uploaded file was empty or missing'), { statusCode: 400 });
  }
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function handleCreateDocument(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const rawBody: unknown = event.body ? JSON.parse(event.body) : {};
  const parsedBody = createDocumentInputSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'Document request body is invalid',
      }),
    };
  }

  const body = parsedBody.data;
  const documentTypeId = body.documentTypeId;
  const name = body.name.trim();
  let contentTypeId = body.contentTypeId ?? null;
  const metadata = body.metadata;
  const source = body.source;
  const tipTapContent = parseRequestTipTapContent(body.content);
  if (tipTapContent) {
    const rejected = rejectUnsafeTipTap(tipTapContent, 'content');
    if (rejected) return rejected;
  }
  const ocrEngine = parseOcrEngineFromBody(body);

  if (!documentTypeId || !name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'documentTypeId and name are required' }),
    };
  }

  if (!source?.kind || (source.kind !== 'file' && source.kind !== 'paste')) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'source is required (kind: file with key, or paste with text)',
      }),
    };
  }

  const dtRows = await db.query(
    `SELECT dt.id, d.access_state AS access_state, dt.size_limit_words, d.archived_at
     FROM document_type dt
     INNER JOIN department d ON d.id = dt.department_id
     WHERE dt.id = $1`,
    [documentTypeId],
  );
  if (dtRows.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: `Document type '${documentTypeId}' was not found`,
      }),
    };
  }

  if (dtRows[0].archived_at) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'DEPARTMENT_ARCHIVED',
        message: 'This department is no longer accepting submissions.',
      }),
    };
  }

  const documentType = {
    id: dtRows[0].id as string,
    accessState: dtRows[0].access_state as 'OPEN' | 'LOCKED',
  };
  const sizeLimitWords =
    typeof dtRows[0].size_limit_words === 'number' ? dtRows[0].size_limit_words : null;
  const createDocPolicy = await getPlatformUsagePolicy(db);
  const platformWordLimit = createDocPolicy.maxWordCount;

  const grants = await loadActiveSubmissionGrants(actor.userId, documentTypeId, db);
  const submissionGate = await gateSubmission(
    {
      resolveAccess: async (_userId, dtId) =>
        resolveAccess({
          documentType: { id: dtId, accessState: documentType.accessState },
          grants,
        }),
    },
    actor.userId,
    documentTypeId,
  );
  if (submissionGate.status === 'requires-access-request') {
    return {
      statusCode: 403,
      body: JSON.stringify({
        code: 'ACCESS_REQUEST_REQUIRED',
        message: 'This department is locked. Request access from a department admin.',
        documentTypeId: submissionGate.documentTypeId,
      }),
    };
  }

  const metadataRows = await db.query<{
    id: string;
    document_type_id: string;
    label: string;
    required: boolean;
  }>(
    `SELECT id, document_type_id, label, required
     FROM custom_metadata_field
     WHERE document_type_id = $1
     ORDER BY label ASC`,
    [documentTypeId],
  );
  const metadataFields: CustomMetadataField[] = metadataRows.map((row) => ({
    id: row.id,
    documentTypeId: row.document_type_id,
    label: row.label,
    required: row.required,
  }));
  const metadataValidation = validateDocumentMetadata(metadataFields, metadata);
  if (metadataValidation.status === 'invalid-metadata-fields') {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'INVALID_METADATA_FIELDS',
        message: 'Document metadata contains fields not configured for this document type.',
        unknownMetadataFieldIds: metadataValidation.unknownMetadataFieldIds,
      }),
    };
  }

  if (metadataValidation.status === 'missing-required-fields') {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'REQUIRED_METADATA_MISSING',
        message: `Complete required fields: ${metadataValidation.missingRequiredFieldLabels.join(', ')}.`,
        missingRequiredFieldIds: metadataValidation.missingRequiredFieldIds,
        missingRequiredFieldLabels: metadataValidation.missingRequiredFieldLabels,
      }),
    };
  }

  if (contentTypeId) {
    const contentTypeRows = await db.query(
      'SELECT id, document_type_id FROM content_type WHERE id = $1',
      [contentTypeId],
    );
    if (contentTypeRows.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'BAD_REQUEST',
          message: `Content type '${contentTypeId}' was not found`,
        }),
      };
    }
    if (contentTypeRows[0].document_type_id !== documentTypeId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'BAD_REQUEST',
          message: 'Content type does not belong to the selected document type',
        }),
      };
    }
  } else {
    const defaultCt = await db.query(
      `SELECT id FROM content_type WHERE document_type_id = $1 ORDER BY label ASC LIMIT 1`,
      [documentTypeId],
    );
    contentTypeId =
      typeof defaultCt[0]?.id === 'string' ? defaultCt[0].id : null;
  }

  let s3Key = 'inline';
  let ingestSource:
    | { kind: 'paste'; pastedText: string }
    | { kind: 'file'; fileName: string; bytes: Buffer }
    | null = null;
  let asyncPdf:
    | { key: string; fileName: string }
    | null = null;
  // Set once the lifetime upload slot has been reserved ahead of OCR on the
  // sync file branch, so the final transaction does not reserve a second time.
  let slotReserved = false;

  if (source.kind === 'paste') {
    const text = typeof source.text === 'string' ? source.text : '';
    if (!text.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'BAD_REQUEST',
          message: 'Paste source requires non-empty text',
        }),
      };
    }
    ingestSource = { kind: 'paste', pastedText: text };
  } else {
    const key = typeof source.key === 'string' ? source.key : '';
    if (!key) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'BAD_REQUEST',
          message: 'File source requires an S3 key from /v1/uploads/presign',
        }),
      };
    }
    const allowedPrefix = `documents/${actor.userId}/`;
    if (!key.startsWith(allowedPrefix)) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          code: 'PERMISSION_DENIED',
          message: 'Upload key does not belong to the authenticated user',
        }),
      };
    }
    const fileName = key.split('/').pop() || 'upload.docx';
    s3Key = key;
    // Fail-closed clear BEFORE any transaction (no S3 call is made while a DB
    // connection or row lock is held). Every failure path below re-tags, and
    // every success path clears again after commit.
    await clearOrphanUploadTag(key);
    // PDF OCR can exceed API Gateway ~29s — enqueue and return immediately.
    if (shouldIngestPdfAsync(fileName)) {
      asyncPdf = { key, fileName };
    } else {
      // Reserve the lifetime upload slot BEFORE fetching bytes or running paid
      // extraction (pdf.js/Textract), mirroring the async branch's
      // reserve-before-enqueue ordering. An over-cap user is rejected before
      // any S3 fetch or OCR and before the Lambda is held for the Textract poll
      // loop. On any rejection, re-tag the upload for lifecycle expiry so the
      // key cannot be replayed to force repeated paid OCR and is not left
      // untagged with nothing referencing it.
      try {
        await reserveDocumentUpload(actor.userId, db);
        slotReserved = true;
      } catch (error) {
        await tagOrphanUploadForExpiry(key);
        throw error;
      }
      const bytes = await readS3ObjectBytes(key);
      ingestSource = { kind: 'file', fileName, bytes };
    }
  }

  if (asyncPdf) {
    const pdf = asyncPdf;
    // Any throw out of the transaction (reservation 429, insert or commit
    // failure) means it rolled back and this request references nothing, so
    // re-tag the upload for lifecycle expiry.
    let created;
    try {
      created = await db.transaction(async (tx) => {
        await reserveDocumentUpload(actor.userId, tx);
        const rows = await tx.query<any>(
          `INSERT INTO document (
             owner_user_id, document_type_id, content_type_id, name, metadata,
             status, created_at, draft_create_count
           ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
           RETURNING id, owner_user_id, document_type_id, content_type_id,
                     name, metadata, status, created_at`,
          [
            actor.userId,
            documentTypeId,
            contentTypeId,
            name,
            JSON.stringify(metadata),
            'Still Drafting',
          ],
        );
        const documentId = rows[0].id as string;
        const job = await insertQueuedIngestJob(tx, {
          documentId,
          s3Key: pdf.key,
          fileName: pdf.fileName,
          ocrEngine,
        });
        return { rows, documentId, job };
      });
    } catch (error) {
      await tagOrphanUploadForExpiry(pdf.key);
      throw error;
    }
    await clearOrphanUploadTagAfterCommit(pdf.key);

    try {
      await enqueueIngestJob({
        jobId: created.job.id,
        documentId: created.documentId,
        s3Key: pdf.key,
        fileName: pdf.fileName,
        userId: actor.userId,
        sizeLimitWords,
        platformSizeLimitWords: platformWordLimit,
        ocrEngine,
      });
    } catch (enqueueError) {
      try {
        await markIngestJobFailed(db, created.job.id, 'Failed to enqueue document ingestion');
      } catch (statusError) {
        console.error('Failed to record document ingest enqueue failure', {
          jobId: created.job.id,
          enqueueError,
          statusError,
        });
      }
      return {
        statusCode: 201,
        body: JSON.stringify({
          ...toDocumentDto(created.rows[0]),
          ingestStatus: 'failed',
          ingestJobId: created.job.id,
        }),
      };
    }
    return {
      statusCode: 201,
      body: JSON.stringify({
        ...toDocumentDto(created.rows[0]),
        ingestStatus: 'queued',
        ingestJobId: created.job.id,
      }),
    };
  }

  let ingestResult;
  try {
    const { extractor } = createPdfExtractor({
      engine: ocrEngine,
      s3Bucket: process.env.DOCUMENTS_BUCKET_NAME,
      s3Key: typeof s3Key === 'string' && s3Key !== 'inline' ? s3Key : undefined,
    });
    ingestResult = await ingestUpload(ingestSource!, {
      docxExtractor,
      pdfExtractor: extractor,
    });
  } catch (error) {
    if (error instanceof UnsupportedFileFormatError) {
      if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
      return {
        statusCode: 400,
        body: JSON.stringify({ code: 'UNSUPPORTED_FORMAT', message: error.message }),
      };
    }
    if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
    throw error;
  }

  if (ingestResult.status === 'fallback') {
    if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'EXTRACTION_FAILED',
        message: ingestResult.reason,
      }),
    };
  }

  // Prefer client TipTap when provided; otherwise use server PDF TipTap (1C).
  const storedContent = tipTapContent ?? ingestResult.content;
  const segments = storedContent
    ? tipTapContentToSegments(storedContent)
    : ingestResult.segments;

  // Header and footer are stored in the draft and fed to AI prompts — include
  // them in the total word/char counts and enforce the same size cap.
  // Body counts are footnote-aware when a TipTap doc is the source so footnote
  // bodies (which reach the Bedrock prompt) cannot bypass the gate; when the
  // source is raw ingest segments, measure the segments directly (f-ca2d70a5).
  const bodyWords = storedContent
    ? wordCountFromTipTapContent(storedContent)
    : countWords(segments);
  const bodyChars = storedContent
    ? charCountFromTipTapContent(storedContent)
    : countChars(segments);
  const headerFooterWords =
    (ingestResult.header ? wordCountFromTipTapContent(ingestResult.header) : 0) +
    (ingestResult.footer ? wordCountFromTipTapContent(ingestResult.footer) : 0);
  const headerFooterChars =
    (ingestResult.header ? charCountFromTipTapContent(ingestResult.header) : 0) +
    (ingestResult.footer ? charCountFromTipTapContent(ingestResult.footer) : 0);
  const overLimit = overSizeLimitHttpResponse(
    bodyWords + headerFooterWords,
    sizeLimitWords,
    platformWordLimit,
    bodyChars + headerFooterChars,
  );
  if (overLimit) {
    if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
    return overLimit;
  }

  const created = await db.transaction(async (tx) => {
    // The sync file branch already reserved the slot ahead of OCR; only reserve
    // here for the paste branch to avoid double-counting.
    if (!slotReserved) {
      await reserveDocumentUpload(actor.userId, tx);
    }
    const rows = await tx.query<any>(
      `INSERT INTO document (
         owner_user_id, document_type_id, content_type_id, name, metadata,
         status, created_at, draft_create_count
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
       RETURNING id, owner_user_id, document_type_id, content_type_id,
                 name, metadata, status, created_at`,
      [
        actor.userId,
        documentTypeId,
        contentTypeId,
        name,
        JSON.stringify(metadata),
        'Still Drafting',
      ],
    );
    const documentId = rows[0].id as string;
    const draftRepo = new DbDraftRepository(tx);
    await createDraftRevision(
      {
        documentId,
        segments,
        wordCount: bodyWords + headerFooterWords,
        s3Key,
        ...(storedContent ? { content: storedContent } : {}),
        ...(ingestResult.header ? { header: ingestResult.header } : {}),
        ...(ingestResult.footer ? { footer: ingestResult.footer } : {}),
        ...(typeof ingestResult.ocrConfidence === 'number'
          ? { ocrConfidence: ingestResult.ocrConfidence }
          : {}),
      },
      draftRepo,
    );
    return { rows, documentId };
  });
  if (s3Key !== 'inline') await clearOrphanUploadTagAfterCommit(s3Key);

  // Analytics counters are intentionally best-effort and outside the atomic
  // user-visible document/draft transaction.
  await updateDepartmentUserCounter(
    documentTypeId,
    actor.userId,
    created.documentId,
    1,
    db,
  );

  return {
    statusCode: 201,
    body: JSON.stringify(toDocumentDto(created.rows[0])),
  };
}

async function handleGetDocument(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};

  const query = `
    SELECT id, owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at
    FROM document
    WHERE id = $1 AND owner_user_id = $2
  `;
  const rows = await db.query(query, [documentId, actor.userId]);

  if (rows.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(toDocumentDto(rows[0])),
  };
}

async function handleDeleteDocument(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};

  // REQ-AUDIT-RETENTION-01 criterion 3: require explicit confirmation.
  const body = event.body ? JSON.parse(event.body) : {};
  if (body.confirmed !== true) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Set confirmed: true to permanently delete this document and all attached feedback.',
      }),
    };
  }

  const docRows = await db.query<{ owner_user_id: string; document_type_id: string }>(
    `SELECT owner_user_id, document_type_id FROM document WHERE id = $1`,
    [documentId],
  );

  if (docRows.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  if (docRows[0].owner_user_id !== actor.userId) {
    return {
      statusCode: 403,
      body: JSON.stringify({ code: 'PERMISSION_DENIED', message: 'Not authorized to delete this document' }),
    };
  }

  const ownerUserId = docRows[0].owner_user_id;
  const documentTypeId = docRows[0].document_type_id;

  // Collect all S3 keys BEFORE deleting draft rows (REQ-SEC-PII-01 criterion 3).
  const draftRows = await db.query<{ s3_key: string }>(
    `SELECT s3_key FROM draft WHERE document_id = $1`,
    [documentId],
  );
  const s3Keys = draftRows.map((r) => r.s3_key).filter((k) => k && k !== 'inline');

  // Delete Postgres rows in dependency order to satisfy FK constraints.
  // resolution_status_history and anchor rows are cleaned up by FK CASCADE
  // when their parent draft/feedback_item rows are deleted.
  await db.query(
    `DELETE FROM resolution_status_history
     WHERE feedback_item_id IN (SELECT id FROM feedback_item WHERE document_id = $1)`,
    [documentId],
  );
  await db.query(
    `DELETE FROM anchor
     WHERE draft_id IN (SELECT id FROM draft WHERE document_id = $1)`,
    [documentId],
  );
  const [draftResult, feedbackResult] = await Promise.all([
    db.query<{ id: string }>('DELETE FROM draft WHERE document_id = $1 RETURNING id', [documentId]),
    db.query<{ id: string }>('DELETE FROM feedback_item WHERE document_id = $1 RETURNING id', [documentId]),
  ]);
  await db.query('DELETE FROM document WHERE id = $1', [documentId]);

  // Maintain department active-user counter — decrement if this was the user's
  // last document in the department (non-fatal if it fails).
  await updateDepartmentUserCounter(documentTypeId, ownerUserId, null, -1, db);

  // Delete S3 objects for all file-upload drafts (REQ-SEC-PII-01 criterion 3).
  if (s3Keys.length > 0) {
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'ca-central-1' });
    const bucketName = process.env.DOCUMENTS_BUCKET_NAME!;
    // DeleteObjects accepts up to 1000 keys per call. It returns a per-key
    // Errors[] (even with Quiet: true) — this is a compliance-driven PII
    // erasure (REQ-SEC-PII-01), so a partial failure must NOT be reported as a
    // clean deletion. Accumulate any per-key errors and fail closed below.
    const deleteErrors: { Key?: string; Code?: string; Message?: string }[] = [];
    for (let i = 0; i < s3Keys.length; i += 1000) {
      const batch = s3Keys.slice(i, i + 1000);
      const resp = await s3.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
      if (resp.Errors?.length) deleteErrors.push(...resp.Errors);
    }
    if (deleteErrors.length > 0) {
      // EMF metric (parsed from stdout) so incomplete erasure is observable.
      console.log(
        JSON.stringify({
          _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
              {
                Namespace: 'WREN/Document',
                Dimensions: [[]],
                Metrics: [{ Name: 'PiiDeleteObjectsFailure', Unit: 'Count' }],
              },
            ],
          },
          PiiDeleteObjectsFailure: 1,
          documentId,
          failedCount: deleteErrors.length,
        }),
      );
      // Error codes only — object keys/bodies are not logged as content.
      console.error(
        JSON.stringify({
          event: 'pii_delete_failed',
          documentId,
          failedCount: deleteErrors.length,
          codes: deleteErrors.map((e) => e.Code),
        }),
      );
      // Fail closed: wrapHandler maps statusCode>=500 to a 500 INTERNAL_ERROR,
      // so the incomplete erasure is neither audited as complete nor returned
      // as a success. Positioned before the audit write and the final 200.
      throw Object.assign(
        new Error('Failed to delete all uploaded objects during erasure'),
        { statusCode: 500 },
      );
    }
  }

  // Delete the DynamoDB conversation session for this document
  // (REQ-AUDIT-RETENTION-01 criterion 1 / REQ-AUDIT-OPSTATE-01 criterion 4).
  const conversationTableName = process.env.CONVERSATION_TABLE_NAME;
  if (conversationTableName) {
    const dynamo = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    await dynamo.send(new DeleteCommand({
      TableName: conversationTableName,
      Key: { sessionId: `${actor.userId}#${documentId}` },
    }));
    // Also delete the canonical lowercase key so mixed-case path params
    // cannot orphan a session after documentId normalization.
    const canonicalId =
      typeof documentId === 'string' ? documentId.toLowerCase() : '';
    if (canonicalId && canonicalId !== documentId) {
      await dynamo.send(new DeleteCommand({
        TableName: conversationTableName,
        Key: { sessionId: `${actor.userId}#${canonicalId}` },
      }));
    }
  }

  // Audit the destructive deletion (Issue #187 / Requirement 44). The
  // activity_event table holds NO foreign key to document/draft/feedback_item,
  // so this record survives the deletion it describes. Best-effort and
  // non-fatal: an audit-write failure must never turn a successful deletion
  // into a user-visible error (the data is already gone). The actor is
  // pseudonymized by the shared writer — the raw userId is never stored.
  try {
    await recordActivityEventRow(
      {
        actorUserId: actor.userId,
        verb: 'document.deleted',
        objectType: 'Document',
        objectRef: documentId,
        documentTypeId,
        context: {
          deletedDrafts: draftResult.length,
          deletedFeedbackItems: feedbackResult.length,
          deletedS3Objects: s3Keys.length,
        },
      },
      db,
    );
  } catch (err) {
    // Structured, non-content log line so the gap is observable even when the
    // audit row could not be written (e.g. a missing GRANT on activity_event).
    console.error(
      JSON.stringify({
        event: 'audit_write_failed',
        action: 'document.deleted',
        documentId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      documentId,
      deletedDrafts: draftResult.length,
      deletedFeedbackItems: feedbackResult.length,
    }),
  };
}

async function handleGetLatestDraft(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};

  const docQuery = `
    SELECT owner_user_id FROM document WHERE id = $1
  `;
  const docRows = await db.query(docQuery, [documentId]);

  if (docRows.length === 0 || docRows[0].owner_user_id !== actor.userId) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  const repo = new DbDraftRepository(db);
  const draft = await repo.getCurrentDraft(documentId as string);

  if (!draft) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'No draft found' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(draft),
  };
}

/**
 * Autosave: update TipTap content (+ optional header/footer) on the current
 * draft without a new version.
 */
async function handlePatchCurrentDraft(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const tipTapContent = parseRequestTipTapContent(body.content);

  if (!tipTapContent) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'Provide TipTap content for autosave',
      }),
    };
  }

  const docRows = await db.query(
    `SELECT owner_user_id, document_type_id FROM document WHERE id = $1`,
    [documentId],
  );

  if (docRows.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  if (docRows[0].owner_user_id !== actor.userId) {
    return {
      statusCode: 403,
      body: JSON.stringify({ code: 'PERMISSION_DENIED', message: 'Not authorized' }),
    };
  }

  const documentTypeId = docRows[0].document_type_id as string;
  const dtRows = await db.query(
    `SELECT size_limit_words FROM document_type WHERE id = $1`,
    [documentTypeId],
  );
  const sizeLimitWords =
    typeof dtRows[0]?.size_limit_words === 'number' ? dtRows[0].size_limit_words : null;
  const patchPolicy = await getPlatformUsagePolicy(db);

  const cleaned = stripAiMarksFromTipTapContent(tipTapContent) as TipTapDoc;
  const header = isTipTapDoc(body.header) ? (body.header as TipTapDoc) : undefined;
  const footer = isTipTapDoc(body.footer) ? (body.footer as TipTapDoc) : undefined;

  for (const [field, doc] of [
    ['content', cleaned],
    ['header', header],
    ['footer', footer],
  ] as const) {
    if (!doc) continue;
    const rejected = rejectUnsafeTipTap(doc, field);
    if (rejected) return rejected;
  }

  const wordCount =
    wordCountFromTipTapContent(cleaned) +
    (header ? wordCountFromTipTapContent(header) : 0) +
    (footer ? wordCountFromTipTapContent(footer) : 0);
  const charCount =
    charCountFromTipTapContent(cleaned) +
    (header ? charCountFromTipTapContent(header) : 0) +
    (footer ? charCountFromTipTapContent(footer) : 0);
  const overLimit = overSizeLimitHttpResponse(
    wordCount,
    sizeLimitWords,
    patchPolicy.maxWordCount,
    charCount,
  );
  if (overLimit) {
    return overLimit;
  }
  const repo = new DbDraftRepository(db);
  const draft = await repo.updateCurrentDraftContent(
    documentId,
    cleaned,
    wordCount,
    header ?? null,
    footer ?? null,
  );

  if (!draft) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'No draft found' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(draft),
  };
}

async function handleCreateDraft(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const source = body.source as
    | { kind?: string; text?: string; key?: string }
    | undefined;
  const { segments } = body;
  const tipTapContent = parseRequestTipTapContent(body.content);
  if (tipTapContent) {
    const rejected = rejectUnsafeTipTap(tipTapContent, 'content');
    if (rejected) return rejected;
  }
  const ocrEngine = parseOcrEngineFromBody(body);
  const hasSource = source?.kind === 'file' || source?.kind === 'paste';
  const hasSegments = Array.isArray(segments);
  const hasContent = !!tipTapContent;

  if (!hasSource && !hasSegments && !hasContent) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'Provide content, segments (editor save), or source (file/paste ingest)',
      }),
    };
  }

  const docQuery = `
    SELECT owner_user_id, document_type_id FROM document WHERE id = $1
  `;
  const docRows = await db.query(docQuery, [documentId]);

  if (docRows.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  if (docRows[0].owner_user_id !== actor.userId) {
    return {
      statusCode: 403,
      body: JSON.stringify({ code: 'PERMISSION_DENIED', message: 'Not authorized' }),
    };
  }

  const documentTypeId = docRows[0].document_type_id as string;
  const dtRows = await db.query(
    `SELECT size_limit_words FROM document_type WHERE id = $1`,
    [documentTypeId],
  );
  const sizeLimitWords =
    typeof dtRows[0]?.size_limit_words === 'number' ? dtRows[0].size_limit_words : null;
  const createDraftPolicy = await getPlatformUsagePolicy(db);
  const draftPlatformWordLimit = createDraftPolicy.maxWordCount;

  let s3Key = 'inline';
  let normalizedSegments: Array<{ index: number; text: string }>;
  let wordCount: number;
  // Authoritative character count (footnote-aware for TipTap sources), used for
  // the defense-in-depth character ceiling alongside wordCount (f-ca2d70a5).
  let charCount: number;
  let storedContent: TipTapDoc | undefined = tipTapContent;
  let storedHeader: TipTapDoc | undefined;
  let storedFooter: TipTapDoc | undefined;
  let storedOcrConfidence: number | undefined;
  // Set once the draft slot has been reserved ahead of OCR on the sync file
  // branch, so the final transaction does not reserve a second time.
  let slotReserved = false;

  if (hasSource) {
    let ingestSource:
      | { kind: 'paste'; pastedText: string }
      | { kind: 'file'; fileName: string; bytes: Buffer };

    if (source!.kind === 'paste') {
      const text = typeof source!.text === 'string' ? source!.text : '';
      if (!text.trim()) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            code: 'BAD_REQUEST',
            message: 'Paste source requires non-empty text',
          }),
        };
      }
      ingestSource = { kind: 'paste', pastedText: text };
    } else {
      const key = typeof source!.key === 'string' ? source!.key : '';
      if (!key) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            code: 'BAD_REQUEST',
            message: 'File source requires an S3 key from /v1/uploads/presign',
          }),
        };
      }
      const allowedPrefix = `documents/${actor.userId}/`;
      if (!key.startsWith(allowedPrefix)) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            code: 'PERMISSION_DENIED',
            message: 'Upload key does not belong to the authenticated user',
          }),
        };
      }
      const fileName = key.split('/').pop() || 'upload.docx';
      s3Key = key;
      // Fail-closed clear BEFORE any transaction (no S3 call is made while a
      // DB connection or row lock is held). Every failure path below re-tags,
      // and every success path clears again after commit.
      await clearOrphanUploadTag(key);

      if (shouldIngestPdfAsync(fileName)) {
        // Any throw out of the transaction (ownership 404, reservation 429,
        // insert or commit failure) means it rolled back and this request
        // references nothing, so re-tag the upload.
        let job;
        try {
          job = await db.transaction(async (tx) => {
            const locked = await tx.query<{ owner_user_id: string }>(
              'SELECT owner_user_id FROM document WHERE id = $1 FOR UPDATE',
              [documentId],
            );
            if (!locked[0] || locked[0].owner_user_id !== actor.userId) {
              throw Object.assign(new Error('Document not found'), { statusCode: 404 });
            }
            await reserveDraftCreate(documentId, tx);
            const queued = await insertQueuedIngestJob(tx, {
              documentId: documentId as string,
              s3Key: key,
              fileName,
              ocrEngine,
            });
            return queued;
          });
        } catch (error) {
          await tagOrphanUploadForExpiry(key);
          throw error;
        }
        await clearOrphanUploadTagAfterCommit(key);
        try {
          await enqueueIngestJob({
            jobId: job.id,
            documentId: documentId as string,
            s3Key: key,
            fileName,
            userId: actor.userId,
            sizeLimitWords,
            platformSizeLimitWords: draftPlatformWordLimit,
            ocrEngine,
          });
        } catch (enqueueError) {
          const errorMessage =
            'The upload was saved, but PDF processing could not be queued. Please try again.';
          try {
            await markIngestJobFailed(db, job.id, 'Failed to enqueue draft ingestion');
          } catch (statusError) {
            console.error('Failed to record draft ingest enqueue failure', {
              jobId: job.id,
              enqueueError,
              statusError,
            });
          }
          return {
            statusCode: 202,
            body: JSON.stringify({
              ingestStatus: 'failed',
              jobId: job.id,
              documentId,
              errorMessage,
            }),
          };
        }
        return {
          statusCode: 202,
          body: JSON.stringify({
            ingestStatus: 'queued',
            jobId: job.id,
            documentId,
          }),
        };
      }

      // Reserve the draft slot BEFORE paid extraction on the sync file branch,
      // mirroring the async branch's lock → verify → reserve → enqueue ordering.
      // An over-cap request is rejected before any OCR runs. On rejection,
      // re-tag the upload for lifecycle expiry so the key cannot be replayed.
      try {
        await db.transaction(async (tx) => {
          const locked = await tx.query<{ owner_user_id: string }>(
            'SELECT owner_user_id FROM document WHERE id = $1 FOR UPDATE',
            [documentId],
          );
          if (!locked[0] || locked[0].owner_user_id !== actor.userId) {
            throw Object.assign(new Error('Document not found'), { statusCode: 404 });
          }
          await reserveDraftCreate(documentId, tx);
        });
        slotReserved = true;
      } catch (error) {
        // Ownership 404 or reservation 429: nothing references the key.
        await tagOrphanUploadForExpiry(key);
        throw error;
      }

      const bytes = await readS3ObjectBytes(key);
      ingestSource = { kind: 'file', fileName, bytes };
    }

    let ingestResult;
    try {
      const { extractor } = createPdfExtractor({
        engine: ocrEngine,
        s3Bucket: process.env.DOCUMENTS_BUCKET_NAME,
        s3Key: typeof s3Key === 'string' && s3Key !== 'inline' ? s3Key : undefined,
      });
      ingestResult = await ingestUpload(ingestSource, {
        docxExtractor,
        pdfExtractor: extractor,
      });
    } catch (error) {
      if (error instanceof UnsupportedFileFormatError) {
        if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
        return {
          statusCode: 400,
          body: JSON.stringify({ code: 'UNSUPPORTED_FORMAT', message: error.message }),
        };
      }
      if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
      throw error;
    }

    if (ingestResult.status === 'fallback') {
      if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'EXTRACTION_FAILED',
          message: ingestResult.reason,
        }),
      };
    }

    // Client TipTap wins; else server PDF TipTap from ingest.
    storedContent = tipTapContent ?? ingestResult.content;
    storedHeader = ingestResult.header ?? undefined;
    storedFooter = ingestResult.footer ?? undefined;
    storedOcrConfidence = ingestResult.ocrConfidence;
    normalizedSegments = storedContent
      ? tipTapContentToSegments(storedContent)
      : normalizeSegments(ingestResult.segments);
    // Body counts are footnote-aware for TipTap sources so footnote bodies
    // cannot bypass the gate; raw ingest segments are measured directly.
    wordCount = storedContent
      ? wordCountFromTipTapContent(storedContent)
      : countWords(normalizedSegments);
    charCount = storedContent
      ? charCountFromTipTapContent(storedContent)
      : countChars(normalizedSegments);
    const overLimit = overSizeLimitHttpResponse(
      wordCount,
      sizeLimitWords,
      draftPlatformWordLimit,
      charCount,
    );
    if (overLimit) {
      if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
      return overLimit;
    }
  } else if (tipTapContent) {
    normalizedSegments = tipTapContentToSegments(tipTapContent);
    wordCount = wordCountFromTipTapContent(tipTapContent);
    charCount = charCountFromTipTapContent(tipTapContent);
    const overLimit = overSizeLimitHttpResponse(
      wordCount,
      sizeLimitWords,
      draftPlatformWordLimit,
      charCount,
    );
    if (overLimit) {
      return overLimit;
    }
  } else {
    // Segments write branch: body.segments is taken directly and is NOT passed
    // through rejectUnsafeTipTap, so the 8MB-per-field TipTap bound does not
    // apply here. Enforce a serialized-bytes cap on the raw payload plus the
    // word/char ceiling BEFORE reserving a draft slot (f-ca2d70a5).
    const segmentBytes = serializedTipTapBytes(segments);
    if (segmentBytes > TIPTAP_FIELD_MAX_BYTES) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'PAYLOAD_TOO_LARGE',
          message: `segments exceeds the ${Math.round(TIPTAP_FIELD_MAX_BYTES / 1_048_576)}MB serialized size limit`,
        }),
      };
    }
    normalizedSegments = normalizeSegments(segments);
    wordCount = countWords(normalizedSegments);
    charCount = countChars(normalizedSegments);
    const overLimit = overSizeLimitHttpResponse(
      wordCount,
      sizeLimitWords,
      draftPlatformWordLimit,
      charCount,
    );
    if (overLimit) {
      return overLimit;
    }
  }

  // Include header and footer words in the total — they are stored in the
  // draft and used in AI prompts just like body content.
  const headerFooterWords =
    (storedHeader ? wordCountFromTipTapContent(storedHeader) : 0) +
    (storedFooter ? wordCountFromTipTapContent(storedFooter) : 0);
  const headerFooterChars =
    (storedHeader ? charCountFromTipTapContent(storedHeader) : 0) +
    (storedFooter ? charCountFromTipTapContent(storedFooter) : 0);
  if (headerFooterWords > 0 || headerFooterChars > 0) {
    const overLimit = overSizeLimitHttpResponse(
      wordCount + headerFooterWords,
      sizeLimitWords,
      draftPlatformWordLimit,
      charCount + headerFooterChars,
    );
    if (overLimit) {
      if (s3Key !== 'inline') await tagOrphanUploadForExpiry(s3Key);
      return overLimit;
    }
    wordCount += headerFooterWords;
  }

  const draft = await db.transaction(async (tx) => {
    const locked = await tx.query<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM document WHERE id = $1 FOR UPDATE',
      [documentId],
    );
    if (!locked[0] || locked[0].owner_user_id !== actor.userId) {
      throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    }
    // The sync file branch already reserved the slot ahead of OCR; only reserve
    // here for the paste / segments / client-TipTap branches.
    if (!slotReserved) {
      await reserveDraftCreate(documentId, tx);
    }
    const draftRepo = new DbDraftRepository(tx);
    const result = await createDraftRevision(
      {
        documentId: documentId as string,
        segments: normalizedSegments,
        wordCount,
        s3Key,
        ...(storedContent ? { content: storedContent } : {}),
        ...(storedHeader ? { header: storedHeader } : {}),
        ...(storedFooter ? { footer: storedFooter } : {}),
        ...(typeof storedOcrConfidence === 'number'
          ? { ocrConfidence: storedOcrConfidence }
          : {}),
      },
      draftRepo,
    );
    return result.draft;
  });
  if (s3Key !== 'inline') await clearOrphanUploadTagAfterCommit(s3Key);

  return {
    statusCode: 201,
    body: JSON.stringify(draft),
  };
}

async function handlePresignUpload(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const filename = typeof body.filename === 'string' ? body.filename : '';
  const rawContentType =
    typeof body.contentType === 'string' ? body.contentType : '';

  if (!filename.trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'filename is required' }),
    };
  }

  const contentType = canonicalUploadContentType(filename, rawContentType);
  if (!contentType) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'UNSUPPORTED_FORMAT',
        message: 'Only .docx and .pdf uploads are supported',
      }),
    };
  }

  await assertDocumentUploadAllowed(actor.userId, db);

  const policy = await getPlatformUsagePolicy(db);
  const maxFileSizeBytes = policy.maxUploadFileSizeBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  const safeName = filename.replace(/[^\w.\-()+ ]+/g, '_');
  const key = `documents/${actor.userId}/uploads/${uuid()}-${safeName}`;
  const kmsKeyArn = process.env.DOCUMENTS_KMS_KEY_ARN?.trim();
  const encryptionFields: Record<string, string> = kmsKeyArn
    ? {
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': kmsKeyArn,
        'x-amz-server-side-encryption-bucket-key-enabled': 'true',
      }
    : {};
  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: process.env.DOCUMENTS_BUCKET_NAME!,
    Key: key,
    Conditions: [
      ['content-length-range', 1, maxFileSizeBytes],
      ['eq', '$Content-Type', contentType],
      ['eq', '$tagging', ORPHAN_UPLOAD_TAGGING],
      ...Object.entries(encryptionFields).map(
        ([name, value]) => ['eq', `$${name}`, value] as ['eq', string, string],
      ),
    ],
    Fields: {
      'Content-Type': contentType,
      tagging: ORPHAN_UPLOAD_TAGGING,
      ...encryptionFields,
    },
    Expires: 15 * 60,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ uploadUrl: url, fields, key, maxFileSizeBytes }),
  };
}

async function handleGetUploadConfig(event: any): Promise<APIGatewayProxyResult> {
  parseAuthContext(event); // ensure authenticated
  const db = await getDataAccess();
  const policy = await getPlatformUsagePolicy(db);
  const maxFileSizeBytes = policy.maxUploadFileSizeBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  return {
    statusCode: 200,
    body: JSON.stringify({ maxFileSizeBytes, maxWordCount: policy.maxWordCount }),
  };
}

async function handleGetIngestStatus(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};

  const docRows = await db.query(
    `SELECT owner_user_id FROM document WHERE id = $1`,
    [documentId],
  );
  if (docRows.length === 0 || docRows[0].owner_user_id !== actor.userId) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  const status = await getLatestIngestStatus(db, documentId as string);
  return {
    statusCode: 200,
    body: JSON.stringify(status),
  };
}
