/**
 * Feedback Service Lambda entry point — orchestrates feedback generation.
 * Routes: GET/POST /v1/documents/{documentId}/feedback, GET /v1/documents/{documentId}/feedback/status
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
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

  const feedbackQuery = `
    SELECT id, document_id, error_category_id, kind, question_text, quoted_text,
           current_anchor_id, citation_reference_id, source_draft_id, created_at
    FROM feedback_item
    WHERE document_id = $1
    ORDER BY created_at DESC
  `;
  const feedbackRows = await db.query(feedbackQuery, [documentId]);

  const anchorsQuery = `
    SELECT a.id, a.feedback_item_id, a.draft_id, a.paragraph_index, a.start_offset,
           a.end_offset, a.content_fingerprint, a.state
    FROM anchor a
    INNER JOIN feedback_item f ON f.id = a.feedback_item_id
    WHERE f.document_id = $1
    ORDER BY a.created_at ASC
  `;
  const anchorRows = await db.query(anchorsQuery, [documentId]);

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
