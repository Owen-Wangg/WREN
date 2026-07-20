/**
 * Document Service Lambda entry point — routes API Gateway events to service functions.
 * Adapter: API Gateway proxy events → backend/document service handlers.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
// Shared utilities (parseAuthContext, wrapHandler, CORS)
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
  return {
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    s3Key,
    segments,
    wordCount:
      typeof row.word_count === 'number' ? row.word_count : wordCountFromSegments(segments),
    createdAt: toIsoDateTime(row.created_at),
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

async function handleCreateDocument(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const { documentTypeId, contentTypeId, name, metadata } = body;

  if (!documentTypeId || !contentTypeId || !name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'Missing required fields' }),
    };
  }

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
    JSON.stringify(metadata || {}),
    'Still Drafting',
  ]);

  const document = rows[0];

  const draftQuery = `
    INSERT INTO draft (document_id, version_number, s3_key, segments, word_count, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id
  `;
  await db.query(draftQuery, [document.id, 1, 'inline', JSON.stringify([]), 0]);

  return {
    statusCode: 201,
    body: JSON.stringify(toDocumentDto(document)),
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

  await db.query('DELETE FROM draft WHERE document_id = $1', [documentId]);
  await db.query('DELETE FROM feedback_item WHERE document_id = $1', [documentId]);
  await db.query('DELETE FROM document WHERE id = $1', [documentId]);

  return {
    statusCode: 204,
    body: '',
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
    SELECT id, document_id, version_number, s3_key, segments, word_count, created_at
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
  const { segments } = body;

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
      body: JSON.stringify({ code: 'PERMISSION_DENIED', message: 'Not authorized' }),
    };
  }

  const revisionQuery = `
    SELECT COALESCE(MAX(version_number), 0) as max_revision FROM draft WHERE document_id = $1
  `;
  const revisionRows = await db.query(revisionQuery, [documentId]);
  const nextRevision = ((revisionRows[0] as any)?.max_revision ?? 0) + 1;

  const normalizedSegments = normalizeSegments(segments);
  const wordCount = wordCountFromSegments(normalizedSegments);

  const draftQuery = `
    INSERT INTO draft (document_id, version_number, s3_key, segments, word_count, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id, document_id, version_number, s3_key, segments, word_count, created_at
  `;
  const draftRows = await db.query(draftQuery, [
    documentId,
    nextRevision,
    'inline',
    JSON.stringify(normalizedSegments),
    wordCount,
  ]);

  return {
    statusCode: 201,
    body: JSON.stringify(toDraftDto(draftRows[0])),
  };
}

async function handlePresignUpload(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const body = event.body ? JSON.parse(event.body) : {};
  const { documentId, fileType = 'docx' } = body;

  if (!documentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'documentId required' }),
    };
  }

  const key = `documents/${actor.userId}/${documentId}/${uuid()}.${fileType}`;
  const command = new PutObjectCommand({
    Bucket: process.env.DOCUMENTS_BUCKET_NAME!,
    Key: key,
    ContentType: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 15 * 60 });

  return {
    statusCode: 200,
    body: JSON.stringify({ uploadUrl, key }),
  };
}
