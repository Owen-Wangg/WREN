/**
 * Audit Service Lambda entry point — routes API Gateway events to analytics/audit handlers.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { getAnalytics } from './analyticsService';
import { parseAuthContext, wrapHandler } from './lambda-utils';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    if (resource === '/v1/analytics' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetAnalytics(event));
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    };
  } catch (error) {
    console.error('Unhandled error in Audit Lambda:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    };
  }
};

async function handleGetAnalytics(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const query = event.queryStringParameters || {};
  const analytics = await getAnalytics(actor, query, db);
  return {
    statusCode: 200,
    body: JSON.stringify(analytics),
  };
}
