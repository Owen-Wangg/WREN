/**
 * Feedback Service Lambda entry point — orchestrates feedback generation.
 * Routes: GET/POST /v1/documents/{documentId}/feedback, GET /v1/documents/{documentId}/feedback/status
 *
 * TODO: Phase 3 handlers
 * - GET feedback items: query feedback_item table, compute progress summary from resolution history
 * - POST feedback request: usage check via usageEnforcementService, SQS enqueue to FEEDBACK_QUEUE_URL
 * - GET status: check if feedback_item exists for current draft
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    if (resource === '/v1/documents/{documentId}/feedback' && httpMethod === 'GET') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/documents/{documentId}/feedback' && httpMethod === 'POST') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/documents/{documentId}/feedback/status' && httpMethod === 'GET') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    };
  } catch (error) {
    console.error('Unhandled error in Feedback Lambda:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    };
  }
};
