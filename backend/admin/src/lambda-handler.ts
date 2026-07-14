/**
 * Admin Service Lambda entry point — routes API Gateway events to service functions.
 * Handles: departments, document-types, users, roles, usage, overrides, and /v1/auth/me.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { handler as meHandler } from '@wren/auth/src/handlers/me';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    // Route by HTTP method + resource path
    if (resource === '/v1/auth/me' && httpMethod === 'GET') {
      return (await meHandler(event, {} as any, () => {})) as APIGatewayProxyResult;
    }
    if (resource === '/v1/departments' && httpMethod === 'GET') {
      return await handleListDepartments(event);
    }
    if (resource === '/v1/document-types' && httpMethod === 'GET') {
      return await handleListDocumentTypes(event);
    }
    if (resource === '/v1/document-types/{documentTypeId}/config' && httpMethod === 'GET') {
      return await handleGetDocumentTypeConfig(event);
    }
    if (resource === '/v1/document-types/{documentTypeId}/config' && httpMethod === 'PUT') {
      return await handleUpdateDocumentTypeConfig(event);
    }
    if (resource === '/v1/users' && httpMethod === 'GET') {
      return await handleSearchUsers(event);
    }
    if (resource === '/v1/roles' && httpMethod === 'POST') {
      return await handleAssignRole(event);
    }
    if (resource === '/v1/usage' && httpMethod === 'GET') {
      return await handleGetUsage(event);
    }
    if (resource === '/v1/overrides' && httpMethod === 'POST') {
      return await handleGrantOverride(event);
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    };
  } catch (error) {
    console.error('Unhandled error in Admin Lambda:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    };
  }
};

async function handleListDepartments(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleListDocumentTypes(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleGetDocumentTypeConfig(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleUpdateDocumentTypeConfig(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleSearchUsers(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleAssignRole(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleGetUsage(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}

async function handleGrantOverride(event: any): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ code: 'NOT_IMPLEMENTED' }) };
}
