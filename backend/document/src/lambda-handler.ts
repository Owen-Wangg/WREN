/**
 * Document Service Lambda entry point — routes API Gateway events to service functions.
 * Adapter: API Gateway proxy events → backend/document service handlers.
 */
import type { APIGatewayProxyResult, Context } from 'aws-lambda';
import { freezeEventLoopOnReturn, getDataAccess } from '@wren/db-node';
import { S3Client, GetObjectCommand, DeleteObjectsCommand, DeleteObjectTaggingCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuid } from 'uuid';
import { resolveAccess } from '@wren/auth';
import type { AccessGrant, TipTapDoc } from '@wren/types';
import {
  isTipTapDoc,
  stripAiMarksFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
  findDisallowedTipTapNodeType,
  serializedTipTapBytes,
  TIPTAP_FIELD_MAX_BYTES,
} from '@wren/types';

import { MammothDocxExtractor } from './docxExtractor.js';
import { createPdfExtractor } from './ocrFactory.js';
import { resolveOcrEngine } from './textractOcr.js';
import { UnsupportedFileFormatError } from './errors.js';
import { ingestUpload } from './ingestion.js';
import { enforceSizeLimit } from './sizeLimit.js';
import { overSizeLimitHttpResponse } from './patchDraftSizeLimit.js';
import { gateSubmission } from './submissionGating.js';
import { createDraftRevision } from './draftVersioning.js';
import { DbDraftRepository } from './draftRepository.js';
import {
  enqueueIngestJob,
  getLatestIngestStatus,
  insertQueuedIngestJob,
  shouldIngestPdfAsync,
} from './ingestJob.js';
import {
  processIngestQueueMessage,
  type IngestQueueMessage,
} from './ingestWorker.js';
import {
  assertDocumentUploadAllowed,
  reserveDraftCreate,
  reserveDocumentUpload,
  UsageLimitReachedError,
} from '@wren/admin/lifetimeUsagePolicy';

const docxExtractor = new MammothDocxExtractor();

function parseOcrEngineFromBody(body: Record<string, unknown>): string {
  const raw = body.ocrEngine;
  return resolveOcrEngine(typeof raw === 'string' ? raw : null);
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

function withCors(result: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...result,
    headers: {
      ...CORS_HEADERS,
      ...(result.headers as Record<string, string> | undefined),
    },
  };
}

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

async function wrapHandler(fn: () => Promise<APIGatewayProxyResult>): Promise<APIGatewayProxyResult> {
  try {
    return withCors(await fn());
  } catch (error: any) {
    console.error('Error:', error);
    if (error instanceof UsageLimitReachedError) {
      return withCors({
        statusCode: 429,
        body: JSON.stringify({ code: error.code, message: error.message }),
      });
    }
    return withCors({
      statusCode: error.statusCode || 500,
      body: JSON.stringify({
        code: error.statusCode === 403 ? 'PERMISSION_DENIED' : error.statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      }),
    });
  }
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
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

async function clearOrphanUploadTag(key: string): Promise<void> {
  const bucket = process.env.DOCUMENTS_BUCKET_NAME;
  if (!bucket) return;
  try {
    await s3Client.send(
      new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }),
    );
  } catch (err) {
    console.warn('clearOrphanUploadTag: non-fatal error', err);
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

function wordCountFromSegments(segments: Array<{ text: string }>): number {
  return segments.reduce(
    (total, seg) => total + seg.text.split(/\s+/).filter(Boolean).length,
    0,
  );
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
  if (serializedTipTapBytes(doc) > TIPTAP_FIELD_MAX_BYTES) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'PAYLOAD_TOO_LARGE',
        message: `${field} exceeds the 1MB serialized size limit`,
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

  try {
    const { httpMethod, resource } = event;

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
  const body = event.body ? JSON.parse(event.body) : {};
  const documentTypeId = body.documentTypeId as string | undefined;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  let contentTypeId = (body.contentTypeId as string | null | undefined) ?? null;
  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, string>)
      : {};
  const source = body.source as
    | { kind?: string; text?: string; key?: string }
    | undefined;
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

  const grants = normalizeGrants(actor.grants);
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

  // Required custom-metadata gating is deferred: the student New Document
  // flow does not collect metadata fields (Department → Document Type →
  // Name → Upload only). Persist any metadata the client does send.

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
    await clearOrphanUploadTag(key);
    // PDF OCR can exceed API Gateway ~29s — enqueue and return immediately.
    if (shouldIngestPdfAsync(fileName, !!tipTapContent)) {
      asyncPdf = { key, fileName };
    } else {
      const bytes = await readS3ObjectBytes(key);
      ingestSource = { kind: 'file', fileName, bytes };
    }
  }

  await reserveDocumentUpload(actor.userId, db);

  if (asyncPdf) {
    const insertQuery = `
      INSERT INTO document (owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at, draft_create_count)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
      RETURNING id, owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at
    `;
    const rows = await db.query(insertQuery, [
      actor.userId,
      documentTypeId,
      contentTypeId,
      name,
      JSON.stringify(metadata),
      'Still Drafting',
    ]);
    const documentId = (rows[0] as { id: string }).id;
    const job = await insertQueuedIngestJob(db, {
      documentId,
      s3Key: asyncPdf.key,
      fileName: asyncPdf.fileName,
      ocrEngine,
    });
    await enqueueIngestJob({
      jobId: job.id,
      documentId,
      s3Key: asyncPdf.key,
      fileName: asyncPdf.fileName,
      userId: actor.userId,
      sizeLimitWords,
      ocrEngine,
    });
    return {
      statusCode: 201,
      body: JSON.stringify({
        ...toDocumentDto(rows[0]),
        ingestStatus: 'queued',
        ingestJobId: job.id,
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
      return {
        statusCode: 400,
        body: JSON.stringify({ code: 'UNSUPPORTED_FORMAT', message: error.message }),
      };
    }
    throw error;
  }

  if (ingestResult.status === 'fallback') {
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
  const sizeResult = enforceSizeLimit(segments, {
    documentTypeSizeLimitWords: sizeLimitWords,
  });
  if (sizeResult.status === 'over-limit') {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'OVER_SIZE_LIMIT',
        message: sizeResult.message,
        measuredWords: sizeResult.measuredWords,
        effectiveLimitWords: sizeResult.effectiveLimitWords,
      }),
    };
  }

  const insertQuery = `
    INSERT INTO document (owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at, draft_create_count)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
    RETURNING id, owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at
  `;
  const rows = await db.query(insertQuery, [
    actor.userId,
    documentTypeId,
    contentTypeId,
    name,
    JSON.stringify(metadata),
    'Still Drafting',
  ]);
  const document = rows[0] as { id: string };
  const documentId = document.id;

  // Maintain department active-user counter (non-fatal if it fails).
  await updateDepartmentUserCounter(documentTypeId, actor.userId, documentId, 1, db);

  const draftRepo = new DbDraftRepository(db);
  await createDraftRevision(
    {
      documentId,
      segments,
      wordCount: storedContent
        ? wordCountFromTipTapContent(storedContent)
        : sizeResult.measuredWords,
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

  return {
    statusCode: 201,
    body: JSON.stringify(toDocumentDto(rows[0])),
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
    // DeleteObjects accepts up to 1000 keys per call.
    for (let i = 0; i < s3Keys.length; i += 1000) {
      const batch = s3Keys.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
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
  const overLimit = overSizeLimitHttpResponse(wordCount, sizeLimitWords);
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

  await reserveDraftCreate(documentId, db);

  const documentTypeId = docRows[0].document_type_id as string;
  const dtRows = await db.query(
    `SELECT size_limit_words FROM document_type WHERE id = $1`,
    [documentTypeId],
  );
  const sizeLimitWords =
    typeof dtRows[0]?.size_limit_words === 'number' ? dtRows[0].size_limit_words : null;

  let s3Key = 'inline';
  let normalizedSegments: Array<{ index: number; text: string }>;
  let wordCount: number;
  let storedContent: TipTapDoc | undefined = tipTapContent;
  let storedHeader: TipTapDoc | undefined;
  let storedFooter: TipTapDoc | undefined;
  let storedOcrConfidence: number | undefined;

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
      await clearOrphanUploadTag(key);

      if (shouldIngestPdfAsync(fileName, !!tipTapContent)) {
        const job = await insertQueuedIngestJob(db, {
          documentId: documentId as string,
          s3Key: key,
          fileName,
          ocrEngine,
        });
        await enqueueIngestJob({
          jobId: job.id,
          documentId: documentId as string,
          s3Key: key,
          fileName,
          userId: actor.userId,
          sizeLimitWords,
          ocrEngine,
        });
        return {
          statusCode: 202,
          body: JSON.stringify({
            ingestStatus: 'queued',
            jobId: job.id,
            documentId,
          }),
        };
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
        return {
          statusCode: 400,
          body: JSON.stringify({ code: 'UNSUPPORTED_FORMAT', message: error.message }),
        };
      }
      throw error;
    }

    if (ingestResult.status === 'fallback') {
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
    const sizeResult = enforceSizeLimit(normalizedSegments, {
      documentTypeSizeLimitWords: sizeLimitWords,
    });
    if (sizeResult.status === 'over-limit') {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'OVER_SIZE_LIMIT',
          message: sizeResult.message,
          measuredWords: sizeResult.measuredWords,
          effectiveLimitWords: sizeResult.effectiveLimitWords,
        }),
      };
    }
    wordCount = storedContent
      ? wordCountFromTipTapContent(storedContent)
      : sizeResult.measuredWords;
  } else if (tipTapContent) {
    normalizedSegments = tipTapContentToSegments(tipTapContent);
    const sizeResult = enforceSizeLimit(normalizedSegments, {
      documentTypeSizeLimitWords: sizeLimitWords,
    });
    if (sizeResult.status === 'over-limit') {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'OVER_SIZE_LIMIT',
          message: sizeResult.message,
          measuredWords: sizeResult.measuredWords,
          effectiveLimitWords: sizeResult.effectiveLimitWords,
        }),
      };
    }
    wordCount = wordCountFromTipTapContent(tipTapContent);
  } else {
    normalizedSegments = normalizeSegments(segments);
    wordCount = wordCountFromSegments(normalizedSegments);
    const sizeResult = enforceSizeLimit(normalizedSegments, {
      documentTypeSizeLimitWords: sizeLimitWords,
    });
    if (sizeResult.status === 'over-limit') {
      return {
        statusCode: 400,
        body: JSON.stringify({
          code: 'OVER_SIZE_LIMIT',
          message: sizeResult.message,
          measuredWords: sizeResult.measuredWords,
          effectiveLimitWords: sizeResult.effectiveLimitWords,
        }),
      };
    }
    wordCount = sizeResult.measuredWords;
  }

  const draftRepo = new DbDraftRepository(db);
  const { draft } = await createDraftRevision(
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
      ['content-length-range', 1, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
      ['eq', '$tagging', ORPHAN_UPLOAD_TAGGING],
      ...Object.entries(encryptionFields).map(
        ([name, value]) => ['eq', `$${name}`, value] as [string, string, string],
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
    body: JSON.stringify({ uploadUrl: url, fields, key }),
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
