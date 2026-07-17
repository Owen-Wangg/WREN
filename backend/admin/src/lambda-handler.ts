/**
 * Admin Service Lambda entry point — routes API Gateway events to service functions.
 * Handles: departments, document-types, users, roles, usage, overrides, and /v1/auth/me.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { listDepartments, getDepartment } from './departmentService';
import { listDocumentTypes, listAllDocumentTypes } from './documentTypeService';
import { getDocumentTypeConfig, upsertDocumentTypeConfig } from './documentTypeConfigService';
import { searchUsers } from './userService';
import { assignRole } from './roleAssignmentService';
import { getUsageReport } from './usageLimitService';
import { grantOverride } from './overrideService';
import { listMyAccessGrants } from './accessGrantService';
import { parseAuthContext, wrapHandler, withCors } from './lambda-utils';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, resource } = event;

    // Route by HTTP method + resource path
    if (resource === '/v1/auth/me' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetMe(event));
    }
    if (resource === '/v1/departments' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListDepartments());
    }
    if (resource === '/v1/departments/{departmentId}' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetDepartment(event));
    }
    if (resource === '/v1/document-types' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListDocumentTypes(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/config' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetDocumentTypeConfig(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/config' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleUpdateDocumentTypeConfig(event));
    }
    if (resource === '/v1/users' && httpMethod === 'GET') {
      return await wrapHandler(() => handleSearchUsers(event));
    }
    if (resource === '/v1/roles' && httpMethod === 'POST') {
      return await wrapHandler(() => handleAssignRole(event));
    }
    if (resource === '/v1/usage' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetUsage(event));
    }
    if (resource === '/v1/overrides' && httpMethod === 'POST') {
      return await wrapHandler(() => handleGrantOverride(event));
    }
    if (resource === '/v1/access-grants' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListMyAccessGrants(event));
    }

    return withCors({
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Route not found' }),
    });
  } catch (error) {
    console.error('Unhandled error in Admin Lambda:', error);
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    });
  }
};

async function handleGetMe(event: any): Promise<APIGatewayProxyResult> {
  // The authorizer already resolved the user's identity and placed it in the
  // request context. We just parse it out and return it to the frontend.
  const actor = parseAuthContext(event);
  return {
    statusCode: 200,
    body: JSON.stringify({
      userId: actor.userId,
      email: actor.email,
      roles: actor.roles,
      administeredDepartmentIds: actor.administeredDepartmentIds,
    }),
  };
}

async function handleListDepartments(): Promise<APIGatewayProxyResult> {
  const db = await getDataAccess();
  const departments = await listDepartments(db);
  return {
    statusCode: 200,
    body: JSON.stringify(departments),
  };
}

async function handleGetDepartment(event: any): Promise<APIGatewayProxyResult> {
  const db = await getDataAccess();
  const { departmentId } = event.pathParameters || {};
  const department = await getDepartment(departmentId, db);
  if (!department) {
    throw Object.assign(new Error('Department not found'), { statusCode: 404 });
  }
  return {
    statusCode: 200,
    body: JSON.stringify(department),
  };
}

async function handleListDocumentTypes(event: any): Promise<APIGatewayProxyResult> {
  const db = await getDataAccess();
  const { departmentId } = event.queryStringParameters || {};
  const types = departmentId
    ? await listDocumentTypes(departmentId, db)
    : await listAllDocumentTypes(db);
  return {
    statusCode: 200,
    body: JSON.stringify(types),
  };
}

async function handleListMyAccessGrants(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const grants = await listMyAccessGrants(actor, db);
  return {
    statusCode: 200,
    body: JSON.stringify(grants),
  };
}

async function handleGetDocumentTypeConfig(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.pathParameters || {};
  const config = await getDocumentTypeConfig(actor, documentTypeId, db);
  return {
    statusCode: 200,
    body: JSON.stringify(config),
  };
}

async function handleUpdateDocumentTypeConfig(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const config = await upsertDocumentTypeConfig(actor, documentTypeId, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify(config),
  };
}

async function handleSearchUsers(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const input = event.queryStringParameters || {};
  const users = await searchUsers(actor, input, db);
  return {
    statusCode: 200,
    body: JSON.stringify(users),
  };
}

async function handleAssignRole(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const result = await assignRole(actor, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

async function handleGetUsage(event: any): Promise<APIGatewayProxyResult> {
  const db = await getDataAccess();
  const { scope, periodStart } = event.queryStringParameters || {};

  // Parse scope into the expected { kind: 'platform' | 'documentType'; documentTypeId?: string }
  const scopeObj = scope === 'platform'
    ? { kind: 'platform' as const }
    : { kind: 'documentType' as const, documentTypeId: scope };

  const periodStartDate = periodStart ? new Date(periodStart) : new Date();
  const report = await getUsageReport(scopeObj, periodStartDate, db);

  return {
    statusCode: 200,
    body: JSON.stringify(report),
  };
}

async function handleGrantOverride(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const result = await grantOverride(actor, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}
