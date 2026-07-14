/**
 * Feedback Service Lambda entry point — orchestrates feedback generation.
 * Routes: GET/POST /v1/documents/{documentId}/feedback, GET /v1/documents/{documentId}/feedback/status
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    if (resource === '/v1/documents/{documentId}/feedback' && httpMethod === 'GET') {
      return handleGetFeedback(event);
    }
    if (resource === '/v1/documents/{documentId}/feedback' && httpMethod === 'POST') {
      return handleRequestFeedback(event);
    }
    if (resource === '/v1/documents/{documentId}/feedback/status' && httpMethod === 'GET') {
      return handleGetFeedbackStatus(event);
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

async function handleGetFeedback(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleRequestFeedback(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleGetFeedbackStatus(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}
