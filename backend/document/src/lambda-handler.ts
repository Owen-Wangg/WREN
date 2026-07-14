/**
 * Document Service Lambda entry point — routes API Gateway events to service functions.
 * Adapter: API Gateway proxy events → backend/document service handlers.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource, pathParameters } = event;

    // Route by HTTP method + resource path
    if (resource === '/v1/documents' && httpMethod === 'GET') {
      return handleListDocuments(event);
    }
    if (resource === '/v1/documents' && httpMethod === 'POST') {
      return handleCreateDocument(event);
    }
    if (resource === '/v1/documents/{documentId}' && httpMethod === 'GET') {
      return handleGetDocument(event);
    }
    if (resource === '/v1/documents/{documentId}' && httpMethod === 'DELETE') {
      return handleDeleteDocument(event);
    }
    if (resource === '/v1/documents/{documentId}/drafts' && httpMethod === 'POST') {
      return handleSubmitDraft(event);
    }
    if (resource === '/v1/uploads/presign' && httpMethod === 'POST') {
      return handleGetUploadUrl(event);
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    };
  } catch (error) {
    console.error('Unhandled error in Document Lambda:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    };
  }
};

async function handleListDocuments(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleCreateDocument(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleGetDocument(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleDeleteDocument(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleSubmitDraft(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleGetUploadUrl(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}
