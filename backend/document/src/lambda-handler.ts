/**
 * Document Service Lambda entry point — routes API Gateway events to service functions.
 * Adapter: API Gateway proxy events → backend/document service handlers.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { resolveAccess } from '@wren/auth';
import type { AccessGrant, TipTapDoc } from '@wren/types';
import {
  isTipTapDoc,
  stripAiMarksFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
} from '@wren/types';

import { MammothDocxExtractor } from './docxExtractor.js';
import { LiteParsePdfExtractor } from './pdfExtractor.js';
import { UnsupportedFileFormatError } from './errors.js';
import { ingestUpload } from './ingestion.js';
import { enforceSizeLimit } from './sizeLimit.js';
import { gateSubmission } from './submissionGating.js';
import { createDraftRevision } from './draftVersioning.js';
import { DbDraftRepository } from './draftRepository.js';
import {
  assertDocumentUploadAllowed,
  assertDraftCreateAllowed,
  UsageLimitReachedError,
} from '@wren/admin/lifetimeUsagePolicy';

const docxExtractor = new MammothDocxExtractor();
const pdfExtractor = new LiteParsePdfExtractor();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ca-central-1' });

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

/** Map a `draft` row to the shared camelCase Draft DTO. */
function toDraftDto(row: any) {
  const segmentsRaw =
    typeof row.segments === 'string' ? JSON.parse(row.segments) : (row.segments ?? []);
  const segments = normalizeSegments(segmentsRaw);
  const s3Key =
    typeof row.s3_key === 'string' && row.s3_key.length > 0 ? row.s3_key : 'inline';
  const contentRaw =
    typeof row.content === 'string'
      ? (() => {
          try {
            return JSON.parse(row.content);
          } catch {
            return null;
          }
        })()
      : row.content;
  const content = isTipTapDoc(contentRaw) ? (contentRaw as TipTapDoc) : undefined;
  return {
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    s3Key,
    segments,
    wordCount:
      typeof row.word_count === 'number' ? row.word_count : wordCountFromSegments(segments),
    createdAt: toIsoDateTime(row.created_at),
    ...(content ? { content } : {}),
  };
}

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
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
    `SELECT dt.id, d.access_state AS access_state, dt.size_limit_words
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
    | { kind: 'file'; fileName: string; bytes: Buffer };

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
    const bytes = await readS3ObjectBytes(key);
    const fileName = key.split('/').pop() || 'upload.docx';
    ingestSource = { kind: 'file', fileName, bytes };
    s3Key = key;
  }

  let ingestResult;
  try {
    ingestResult = await ingestUpload(ingestSource, { docxExtractor, pdfExtractor });
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

  await assertDocumentUploadAllowed(actor.userId, db);

  const insertQuery = `
    INSERT INTO document (owner_user_id, document_type_id, content_type_id, name, metadata, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
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

  const docQuery = `
    SELECT owner_user_id FROM document WHERE id = $1
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
      body: JSON.stringify({ code: 'PERMISSION_DENIED', message: 'Not authorized to delete this document' }),
    };
  }

  const [draftResult, feedbackResult] = await Promise.all([
    db.query<{ id: string }>('DELETE FROM draft WHERE document_id = $1 RETURNING id', [documentId]),
    db.query<{ id: string }>('DELETE FROM feedback_item WHERE document_id = $1 RETURNING id', [documentId]),
  ]);
  await db.query('DELETE FROM document WHERE id = $1', [documentId]);

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

  const draftQuery = `
    SELECT id, document_id, version_number, s3_key, segments, word_count, created_at, content
    FROM draft
    WHERE document_id = $1
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const draftRows = await db.query(draftQuery, [documentId]);

  if (draftRows.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'No draft found' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(toDraftDto(draftRows[0])),
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

  await assertDraftCreateAllowed(documentId, db);

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

  if (hasSource) {
    let ingestSource:
      | { kind: 'paste'; pastedText: string }
      | { kind: 'file'; fileName: string; bytes: Buffer };

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
      const bytes = await readS3ObjectBytes(key);
      const fileName = key.split('/').pop() || 'upload.docx';
      ingestSource = { kind: 'file', fileName, bytes };
      s3Key = key;
    }

    let ingestResult;
    try {
      ingestResult = await ingestUpload(ingestSource, { docxExtractor, pdfExtractor });
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
  const body = event.body ? JSON.parse(event.body) : {};
  const filename = typeof body.filename === 'string' ? body.filename : '';
  const contentType =
    typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream';

  if (!filename.trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'filename is required' }),
    };
  }

  const safeName = filename.replace(/[^\w.\-()+ ]+/g, '_');
  const key = `documents/${actor.userId}/uploads/${uuid()}-${safeName}`;
  const command = new PutObjectCommand({
    Bucket: process.env.DOCUMENTS_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 15 * 60 });

  return {
    statusCode: 200,
    body: JSON.stringify({ uploadUrl, key }),
  };
}
