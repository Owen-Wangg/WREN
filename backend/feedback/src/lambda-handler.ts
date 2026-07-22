/**
 * Feedback Service Lambda entry point — orchestrates feedback generation.
 * Routes: GET/POST /v1/documents/{documentId}/feedback, GET /v1/documents/{documentId}/feedback/status
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuid } from 'uuid';

import {
  appendAskWrenTurn,
  buildSessionId,
  loadDocumentConversation,
} from './askWren.js';
import {
  assertAskMessageAllowed,
  reserveDebriefGeneration,
  UsageLimitReachedError,
} from '@wren/admin/lifetimeUsagePolicy';
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

function toIsoDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) {
    return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  }
  return new Date().toISOString();
}

/** Map a `feedback_item` row to the shared camelCase FeedbackItem DTO. */
function toFeedbackItemDto(row: any) {
  return {
    id: row.id,
    documentId: row.document_id,
    errorCategoryId: row.error_category_id,
    kind: row.kind,
    questionText: row.question_text,
    ...(row.quoted_text ? { quotedText: row.quoted_text } : {}),
    ...(row.current_anchor_id ? { currentAnchorId: row.current_anchor_id } : {}),
    ...(row.citation_reference_id ? { citationReferenceId: row.citation_reference_id } : {}),
    sourceDraftId: row.source_draft_id,
    createdAt: toIsoDateTime(row.created_at),
  };
}

/** Map an `anchor` row to the shared camelCase Anchor DTO. */
function toAnchorDto(row: any) {
  return {
    id: row.id,
    feedbackItemId: row.feedback_item_id,
    draftId: row.draft_id,
    paragraphIndex: row.paragraph_index,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    contentFingerprint: row.content_fingerprint,
    state: row.state,
  };
}

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'ca-central-1' });

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    if (resource === '/v1/documents/{documentId}/feedback' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetFeedback(event));
    }
    if (resource === '/v1/documents/{documentId}/feedback' && httpMethod === 'POST') {
      return await wrapHandler(() => handleRequestFeedback(event));
    }
    if (resource === '/v1/documents/{documentId}/feedback/status' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetFeedbackStatus(event));
    }
    if (resource === '/v1/documents/{documentId}/ask-wren' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetAskWrenSession(event));
    }
    if (resource === '/v1/documents/{documentId}/ask-wren' && httpMethod === 'POST') {
      return await wrapHandler(() => handlePostAskWren(event));
    }
    if (resource === '/v1/feedback-helpfulness' && httpMethod === 'POST') {
      return await wrapHandler(() => handleRecordFeedbackHelpfulness(event));
    }

    return withCors({
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    });
  } catch (error) {
    console.error('Unhandled error in Feedback Lambda:', error);
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    });
  }
};

async function handleGetFeedback(event: any): Promise<APIGatewayProxyResult> {
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

  // Only return feedback for the latest draft so regeneration replaces rather than appends.
  const latestDraftQuery = `
    SELECT id FROM draft WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1
  `;
  const latestDraftRows = await db.query(latestDraftQuery, [documentId]);
  const latestDraftId = (latestDraftRows[0] as any)?.id ?? null;

  const feedbackQuery = `
    SELECT id, document_id, error_category_id, kind, question_text, quoted_text,
           current_anchor_id, citation_reference_id, source_draft_id, created_at
    FROM feedback_item
    WHERE document_id = $1${latestDraftId ? ` AND source_draft_id = $2` : ''}
    ORDER BY created_at DESC
  `;
  const feedbackRows = await db.query(
    feedbackQuery,
    latestDraftId ? [documentId, latestDraftId] : [documentId],
  );

  const anchorsQuery = `
    SELECT a.id, a.feedback_item_id, a.draft_id, a.paragraph_index, a.start_offset,
           a.end_offset, a.content_fingerprint, a.state
    FROM anchor a
    INNER JOIN feedback_item f ON f.id = a.feedback_item_id
    WHERE f.document_id = $1${latestDraftId ? ` AND f.source_draft_id = $2` : ''}
    ORDER BY a.created_at ASC
  `;
  const anchorRows = await db.query(
    anchorsQuery,
    latestDraftId ? [documentId, latestDraftId] : [documentId],
  );

  // Build a categoryId → name map from the distinct category IDs present in the items
  const categoryIds = [...new Set(feedbackRows.map((r: any) => r.error_category_id).filter(Boolean))];
  const categoryNames: Record<string, string> = {};
  if (categoryIds.length > 0) {
    const catRows = await db.query(
      `SELECT id, name FROM error_category WHERE id = ANY($1)`,
      [categoryIds],
    );
    for (const row of catRows as any[]) {
      categoryNames[row.id] = row.name;
    }
  }

  // Build progress summary by comparing category counts across the two most recent drafts.
  // Only populated when >= 2 drafts exist for this document (Requirement 18, REQ-PROGRESS-ACK-01).
  type ProgressPattern = { category: string; tendency: 'improving' | 'persistent' | 'emerging'; description: string };
  const progressSummary: ProgressPattern[] = [];

  const draftRows = await db.query<{ id: string; version_number: number }>(
    `SELECT id, version_number FROM draft WHERE document_id = $1 ORDER BY version_number DESC LIMIT 2`,
    [documentId],
  );

  if (draftRows.length >= 2) {
    const [currentDraft, previousDraft] = draftRows;

    const countRows = await db.query<{ draft_id: string; error_category_id: string; cnt: string }>(
      `SELECT source_draft_id AS draft_id, error_category_id, COUNT(*) AS cnt
       FROM feedback_item
       WHERE source_draft_id = ANY($1)
       GROUP BY source_draft_id, error_category_id`,
      [[currentDraft.id, previousDraft.id]],
    );

    const current: Record<string, number> = {};
    const previous: Record<string, number> = {};
    for (const r of countRows) {
      const map = r.draft_id === currentDraft.id ? current : previous;
      map[r.error_category_id] = parseInt(r.cnt, 10);
    }

    const allCategoryIds = new Set([...Object.keys(current), ...Object.keys(previous)]);
    for (const catId of allCategoryIds) {
      const name = categoryNames[catId];
      if (!name) continue;
      const curr = current[catId] ?? 0;
      const prev = previous[catId] ?? 0;

      let tendency: 'improving' | 'persistent' | 'emerging';
      let description: string;

      if (prev === 0 && curr > 0) {
        tendency = 'emerging';
        description = `${name} is a new pattern in your latest draft.`;
      } else if (curr < prev) {
        tendency = 'improving';
        description = `${name} issues decreased from ${prev} to ${curr} — keep it up.`;
      } else if (curr > prev) {
        tendency = 'persistent';
        description = `${name} issues increased from ${prev} to ${curr} — worth focusing on.`;
      } else {
        tendency = 'persistent';
        description = `${name} remains at ${curr} — consistent pattern across drafts.`;
      }

      progressSummary.push({ category: name, tendency, description });
    }

    // Sort: improving first, then persistent, then emerging
    const order = { improving: 0, persistent: 1, emerging: 2 };
    progressSummary.sort((a, b) => order[a.tendency] - order[b.tendency]);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      items: feedbackRows.map((row: any) => toFeedbackItemDto(row)),
      anchors: anchorRows.map((row: any) => toAnchorDto(row)),
      categoryNames,
      progressSummary,
    }),
  };
}

async function handleRequestFeedback(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentId } = event.pathParameters || {};

  const docQuery = `
    SELECT owner_user_id, document_type_id FROM document WHERE id = $1
  `;
  const docRows = await db.query(docQuery, [documentId]);

  if (docRows.length === 0 || docRows[0].owner_user_id !== actor.userId) {
    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
    };
  }

  const draftQuery = `
    SELECT id, version_number FROM draft WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1
  `;
  const draftRows = await db.query(draftQuery, [documentId]);

  if (draftRows.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'No draft found' }),
    };
  }

  const draft = draftRows[0];
  const jobId = uuid();

  await reserveDebriefGeneration(documentId, db);

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.FEEDBACK_QUEUE_URL!,
    MessageBody: JSON.stringify({
      jobId,
      documentId,
      draftId: draft.id,
      userId: actor.userId,
      writingTypeId: docRows[0].document_type_id,
      enqueuedAt: new Date().toISOString(),
    }),
  }));

  return {
    statusCode: 202,
    body: JSON.stringify({ jobId, status: 'queued' }),
  };
}

async function handleRecordFeedbackHelpfulness(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();

  if (!actor.userId) {
    return withCors({ statusCode: 401, body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Authentication required' }) });
  }

  const body = event.body ? JSON.parse(event.body) : {};
  const { environmentId, draftId, helpful, comment } = body;

  if (!environmentId || typeof helpful !== 'boolean') {
    return withCors({ statusCode: 400, body: JSON.stringify({ code: 'BAD_REQUEST', message: 'environmentId and helpful are required' }) });
  }

  // Verify the document exists and belongs to this student.
  const docRows = await db.query<{ owner_user_id: string; document_type_id: string }>(
    `SELECT owner_user_id, document_type_id FROM document WHERE id = $1`,
    [environmentId],
  );
  if (docRows.length === 0 || docRows[0].owner_user_id !== actor.userId) {
    return withCors({ statusCode: 404, body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }) });
  }

  const documentTypeId = docRows[0].document_type_id;
  // draft_id is nullable — 'none' is not a valid uuid so fall back to null.
  const effectiveDraftId: string | null = (draftId && draftId !== 'none') ? draftId : null;

  await db.query(
    `INSERT INTO feedback_helpfulness_rating (document_id, draft_id, document_type_id, helpful, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [environmentId, effectiveDraftId, documentTypeId, helpful, comment ?? null],
  );

  return withCors({ statusCode: 200, body: JSON.stringify({ recorded: true }) });
}

async function handleGetFeedbackStatus(event: any): Promise<APIGatewayProxyResult> {
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
    SELECT id FROM draft WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1
  `;
  const draftRows = await db.query(draftQuery, [documentId]);

  if (draftRows.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'pending' }),
    };
  }

  const feedbackQuery = `
    SELECT COUNT(*) as count FROM feedback_item WHERE source_draft_id = $1
  `;
  const feedbackRows = await db.query(feedbackQuery, [draftRows[0].id]);
  const count = parseInt(String((feedbackRows[0] as any)?.count ?? 0), 10);

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: count > 0 ? 'completed' : 'queued',
      itemCount: count,
      latestDraftId: draftRows[0].id,
    }),
  };
}

async function assertDocumentOwner(
  documentId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; response: APIGatewayProxyResult }> {
  const db = await getDataAccess();
  const docRows = await db.query(
    'SELECT owner_user_id FROM document WHERE id = $1',
    [documentId],
  );
  if (docRows.length === 0 || docRows[0].owner_user_id !== userId) {
    return {
      ok: false,
      response: {
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', message: 'Document not found' }),
      },
    };
  }
  return { ok: true };
}

async function loadDraftSegments(
  documentId: string,
  draftId: string,
  userId: string,
): Promise<
  | { ok: true; segments: Array<{ index?: number; text?: string }> }
  | { ok: false; response: APIGatewayProxyResult }
> {
  const ownership = await assertDocumentOwner(documentId, userId);
  if (!ownership.ok) return ownership;

  const db = await getDataAccess();
  const draftRows = await db.query(
    `SELECT id, segments FROM draft
     WHERE id = $1 AND document_id = $2`,
    [draftId, documentId],
  );
  if (draftRows.length === 0) {
    return {
      ok: false,
      response: {
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', message: 'Draft not found' }),
      },
    };
  }

  const raw = draftRows[0].segments;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? []);
  return {
    ok: true,
    segments: Array.isArray(parsed) ? parsed : [],
  };
}

async function listDraftIdsForDocument(documentId: string): Promise<string[]> {
  const db = await getDataAccess();
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM draft WHERE document_id = $1 ORDER BY version_number ASC`,
    [documentId],
  );
  return rows.map((row) => row.id);
}

async function handleGetAskWrenSession(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const { documentId } = event.pathParameters || {};
  const draftId = event.queryStringParameters?.draftId;

  if (!documentId || !draftId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'documentId and draftId are required',
      }),
    };
  }

  const ownership = await assertDocumentOwner(documentId, actor.userId);
  if (!ownership.ok) return ownership.response;

  const legacyDraftIds = await listDraftIdsForDocument(documentId);
  const session = await loadDocumentConversation({
    userId: actor.userId,
    documentId,
    draftId,
    legacyDraftIds,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      sessionId: session?.sessionId ?? buildSessionId(actor.userId, documentId),
      documentId,
      draftId,
      messages: session?.messages ?? [],
    }),
  };
}

async function handlePostAskWren(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const { documentId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const draftId = body.draftId as string | undefined;
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!documentId || !draftId || !text) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'documentId, draftId, and text are required',
      }),
    };
  }

  const draft = await loadDraftSegments(documentId, draftId, actor.userId);
  if (!draft.ok) return draft.response;

  // Ensure prior turns from older draft-scoped sessions are migrated before append.
  const legacyDraftIds = await listDraftIdsForDocument(documentId);
  const conversation = await loadDocumentConversation({
    userId: actor.userId,
    documentId,
    draftId,
    legacyDraftIds,
  });

  const db = await getDataAccess();
  const userMessageCount = (conversation?.messages ?? []).filter((m) => m.role === 'user').length;
  await assertAskMessageAllowed(userMessageCount, db);

  const { sessionId, reply } = await appendAskWrenTurn({
    userId: actor.userId,
    documentId,
    draftId,
    userText: text,
    draftSegments: draft.segments,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      sessionId,
      message: reply,
    }),
  };
}
