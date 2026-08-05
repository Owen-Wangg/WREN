/**
 * Notification Service Lambda entry point — routes API Gateway events to service
 * functions and processes SQS event records from the notification queue.
 *
 * Dual trigger:
 *   - API Gateway (REST): inbox, unread-count, state transitions, bulk, catalog CRUD
 *   - SQS: notification event processing (from SNS → SQS subscription)
 *   - EventBridge (scheduled): override expiry scanning
 */
import type {
  APIGatewayProxyResult,
  SQSEvent,
} from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { NotificationServiceImpl } from './notificationService';
import { NotificationTypeCatalogServiceImpl } from './catalogService';
import { checkOverrideExpiry } from './overrideExpiryHandler';
import type { NotificationEvent } from './types';

// Shared CORS headers for API Gateway responses.
function withCors(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      ...response.headers,
    },
  };
}

/** Parse the auth context from the API Gateway event (set by the Lambda authorizer). */
function parseAuthContext(event: any): { userId: string; roles: string[] } {
  const ctx = event.requestContext?.authorizer;
  if (!ctx) {
    throw new Error('Missing authorizer context');
  }
  return {
    userId: ctx.userId || ctx.principalId,
    roles: ctx.roles ? (typeof ctx.roles === 'string' ? JSON.parse(ctx.roles) : ctx.roles) : [],
  };
}

/**
 * Unified handler that dispatches based on the event shape:
 *   - Records[] → SQS (notification event processing)
 *   - source: 'aws.events' → EventBridge (override expiry scan)
 *   - httpMethod → API Gateway (REST endpoints)
 */
export const handler = async (event: any): Promise<any> => {
  // SQS event (notification queue consumer)
  if (event.Records && Array.isArray(event.Records)) {
    return handleSqsEvent(event as SQSEvent);
  }

  // EventBridge scheduled rule (override expiry scanning)
  if (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event') {
    return handleScheduledEvent();
  }

  // API Gateway REST event
  return handleApiEvent(event);
};

// ---------------------------------------------------------------------------
// SQS Handler — process notification events from SNS → SQS
// ---------------------------------------------------------------------------
async function handleSqsEvent(event: SQSEvent): Promise<void> {
  const db = await getDataAccess();
  const service = new NotificationServiceImpl(db);

  for (const record of event.Records) {
    try {
      // SNS wraps the message in an envelope
      const body = JSON.parse(record.body);
      const notificationEvent: NotificationEvent = body.Message
        ? JSON.parse(body.Message)
        : body;

      await service.processEvent(notificationEvent);
    } catch (err) {
      console.error('Failed to process notification event:', err, 'Record:', record.messageId);
      throw err; // Let SQS retry / DLQ handle it
    }
  }
}

// ---------------------------------------------------------------------------
// EventBridge Handler — override expiry scanning
// ---------------------------------------------------------------------------
async function handleScheduledEvent(): Promise<void> {
  const db = await getDataAccess();
  const service = new NotificationServiceImpl(db);

  // Read warning hours from SSM parameter (cached in env by Lambda)
  const warningHours = parseInt(process.env.OVERRIDE_EXPIRY_WARNING_HOURS || '24', 10);
  const events = await checkOverrideExpiry(db, { warningHours });

  for (const event of events) {
    try {
      await service.processEvent(event);
    } catch (err) {
      console.error('Failed to process override expiry event:', err);
    }
  }

  console.log(`Override expiry scan complete. Processed ${events.length} events.`);
}

// ---------------------------------------------------------------------------
// API Gateway Handler — REST endpoints
// ---------------------------------------------------------------------------
async function handleApiEvent(event: any): Promise<APIGatewayProxyResult> {
  try {
    const { httpMethod, resource } = event;

    // --- User-facing notification endpoints ---
    if (resource === '/v1/notifications' && httpMethod === 'GET') {
      return await handleGetInbox(event);
    }
    if (resource === '/v1/notifications/unread-count' && httpMethod === 'GET') {
      return await handleGetUnreadCount(event);
    }
    if (resource === '/v1/notifications/{id}' && httpMethod === 'PATCH') {
      return await handleTransitionState(event);
    }
    if (resource === '/v1/notifications/bulk' && httpMethod === 'POST') {
      return await handleBulkAction(event);
    }

    // --- Admin notification type catalog ---
    if (resource === '/v1/admin/notification-types' && httpMethod === 'GET') {
      return await handleListNotificationTypes(event);
    }
    if (resource === '/v1/admin/notification-types' && httpMethod === 'POST') {
      return await handleCreateNotificationType(event);
    }
    if (resource === '/v1/admin/notification-types/{id}' && httpMethod === 'PUT') {
      return await handleUpdateNotificationType(event);
    }

    return withCors({
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    });
  } catch (error: any) {
    console.error('Unhandled error in Notification Lambda:', error);

    if (error.message?.includes('not found')) {
      return withCors({
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', message: error.message }),
      });
    }
    if (error.message?.includes('Invalid state transition') || error.message?.includes('constraint violation')) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ code: 'BAD_REQUEST', message: error.message }),
      });
    }
    if (error.message?.includes('TechnicalAdmin')) {
      return withCors({
        statusCode: 403,
        body: JSON.stringify({ code: 'FORBIDDEN', message: error.message }),
      });
    }

    return withCors({
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    });
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleGetInbox(event: any): Promise<APIGatewayProxyResult> {
  const { userId } = parseAuthContext(event);
  const db = await getDataAccess();
  const service = new NotificationServiceImpl(db);

  const qs = event.queryStringParameters || {};
  const inbox = await service.getInbox(userId, {
    cursor: qs.cursor,
    limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
    stateFilter: qs.stateFilter,
  });

  return withCors({
    statusCode: 200,
    body: JSON.stringify(inbox),
  });
}

async function handleGetUnreadCount(event: any): Promise<APIGatewayProxyResult> {
  const { userId } = parseAuthContext(event);
  const db = await getDataAccess();
  const service = new NotificationServiceImpl(db);

  const count = await service.getUnreadCount(userId);

  return withCors({
    statusCode: 200,
    body: JSON.stringify({ count }),
  });
}

async function handleTransitionState(event: any): Promise<APIGatewayProxyResult> {
  const { userId } = parseAuthContext(event);
  const db = await getDataAccess();
  const service = new NotificationServiceImpl(db);

  const { id } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const { state } = body;

  if (!state || !['read', 'dismissed'].includes(state)) {
    return withCors({
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: "state must be 'read' or 'dismissed'" }),
    });
  }

  await service.transitionState(id, userId, state);

  return withCors({
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  });
}

async function handleBulkAction(event: any): Promise<APIGatewayProxyResult> {
  const { userId } = parseAuthContext(event);
  const db = await getDataAccess();
  const service = new NotificationServiceImpl(db);

  const body = event.body ? JSON.parse(event.body) : {};
  const { action } = body;

  if (!action || !['markAllRead', 'dismissAll'].includes(action)) {
    return withCors({
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: "action must be 'markAllRead' or 'dismissAll'" }),
    });
  }

  const affected = await service.bulkTransition(userId, action);

  return withCors({
    statusCode: 200,
    body: JSON.stringify({ affected }),
  });
}

async function handleListNotificationTypes(event: any): Promise<APIGatewayProxyResult> {
  const { roles } = parseAuthContext(event);
  if (!roles.includes('TechnicalAdmin')) {
    return withCors({
      statusCode: 403,
      body: JSON.stringify({ code: 'FORBIDDEN', message: 'TechnicalAdmin role required' }),
    });
  }

  const db = await getDataAccess();
  const catalog = new NotificationTypeCatalogServiceImpl(db);
  const types = await catalog.list();

  return withCors({
    statusCode: 200,
    body: JSON.stringify(types),
  });
}

async function handleCreateNotificationType(event: any): Promise<APIGatewayProxyResult> {
  const { roles } = parseAuthContext(event);
  if (!roles.includes('TechnicalAdmin')) {
    return withCors({
      statusCode: 403,
      body: JSON.stringify({ code: 'FORBIDDEN', message: 'TechnicalAdmin role required' }),
    });
  }

  const db = await getDataAccess();
  const catalog = new NotificationTypeCatalogServiceImpl(db);
  const body = event.body ? JSON.parse(event.body) : {};

  const created = await catalog.create(body);

  return withCors({
    statusCode: 201,
    body: JSON.stringify(created),
  });
}

async function handleUpdateNotificationType(event: any): Promise<APIGatewayProxyResult> {
  const { roles } = parseAuthContext(event);
  if (!roles.includes('TechnicalAdmin')) {
    return withCors({
      statusCode: 403,
      body: JSON.stringify({ code: 'FORBIDDEN', message: 'TechnicalAdmin role required' }),
    });
  }

  const db = await getDataAccess();
  const catalog = new NotificationTypeCatalogServiceImpl(db);
  const { id } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};

  const updated = await catalog.update(id, body);

  return withCors({
    statusCode: 200,
    body: JSON.stringify(updated),
  });
}
