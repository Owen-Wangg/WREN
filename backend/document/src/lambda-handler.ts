/**
 * Document Service Lambda entry point — routes API Gateway events to service functions.
 * Adapter: API Gateway proxy events → backend/document service handlers.
 *
 * TODO: Phase 3 handlers
 * - Document ingestion requires complex interaction with DocxExtractor, PdfExtractor, and segmentation
 * - See backend/document/src/ingestion.ts for the IngestionDeps pattern and IngestResult types
 * - Size limit checks use backend/document/src/sizeLimit.ts (segments-based, not text-based)
 * - Metadata validation uses backend/document/src/metadataGating.ts (fields retrieved from DB)
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    if (resource === '/v1/documents' && httpMethod === 'GET') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/documents' && httpMethod === 'POST') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/documents/{documentId}' && httpMethod === 'GET') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/documents/{documentId}' && httpMethod === 'DELETE') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/documents/{documentId}/drafts' && httpMethod === 'POST') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
    }
    if (resource === '/v1/uploads/presign' && httpMethod === 'POST') {
      return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
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
