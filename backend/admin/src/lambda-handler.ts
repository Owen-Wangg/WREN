/**
 * Admin Service Lambda entry point — routes API Gateway events to service functions.
 * Handles: departments, document-types, users, roles, usage, overrides, and /v1/auth/me.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { listDepartments, getDepartment, createDepartment } from './departmentService';
import { listDocumentTypes, listAllDocumentTypes, createDocumentType } from './documentTypeService';
import { getDocumentTypeConfig, upsertDocumentTypeConfig } from './documentTypeConfigService';
import { listContentTypes } from './contentTypeService';
import { searchUsers } from './userService';
import { assignRole } from './roleAssignmentService';
import { getUsageReport } from './usageLimitService';
import { grantOverride } from './overrideService';
import { listMyAccessGrants } from './accessGrantService';
import { getAnalytics } from './analyticsService';
import { parseAuthContext, wrapHandler, withCors } from './lambda-utils';
import { handler as syncCognitoAdminsHandler } from './scripts/sync-cognito-admins';

export const handler: APIGatewayProxyHandler = async (event: any): Promise<APIGatewayProxyResult> => {
  // One-shot admin scripts invoked directly via `aws lambda invoke --payload '{"_script":"..."}'`
  if (event['_script'] === 'sync-cognito-admins') {
    return syncCognitoAdminsHandler(event);
  }

  try {
    const { httpMethod, resource } = event;

    // Route by HTTP method + resource path
    if (resource === '/v1/auth/me' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetMe(event));
    }
    if (resource === '/v1/departments' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListDepartments());
    }
    if (resource === '/v1/departments' && httpMethod === 'POST') {
      return await wrapHandler(() => handleCreateDepartment(event));
    }
    if (resource === '/v1/departments/{departmentId}' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetDepartment(event));
    }
    if (resource === '/v1/document-types' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListDocumentTypes(event));
    }
    if (resource === '/v1/document-types' && httpMethod === 'POST') {
      return await wrapHandler(() => handleCreateDocumentType(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/content-types' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListContentTypes(event));
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
    if (resource === '/v1/analytics' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetAnalytics(event));
    }
    if (resource === '/v1/admin/config/model' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetModelConfig());
    }
    if (resource === '/v1/admin/config/model' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleUpdateModelConfig(event));
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

async function handleListContentTypes(event: any): Promise<APIGatewayProxyResult> {
  const db = await getDataAccess();
  const { documentTypeId } = event.pathParameters || {};
  const contentTypes = await listContentTypes(documentTypeId, db);
  return {
    statusCode: 200,
    body: JSON.stringify(contentTypes),
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
  const qs = event.queryStringParameters || {};
  // The frontend sends ?q=<term> as a general search; map it to the schema's
  // named fields. If q contains '@' treat it as an email search, otherwise
  // search both firstName and lastName (the WHERE uses AND so passing all three
  // would require all to match simultaneously).
  const { q, ...rest } = qs;
  const input = q
    ? q.includes('@')
      ? { ...rest, email: q }
      : { ...rest, firstName: q }
    : rest;
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
  await assignRole(actor, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
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

async function handleGetAnalytics(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.queryStringParameters || {};
  const query = documentTypeId ? { documentTypeId } : {};
  const result = await getAnalytics(actor, query, db);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

async function handleCreateDepartment(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const department = await createDepartment(actor, body, db);
  return {
    statusCode: 201,
    body: JSON.stringify(department),
  };
}

async function handleCreateDocumentType(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const documentType = await createDocumentType(actor, body, db);
  return {
    statusCode: 201,
    body: JSON.stringify(documentType),
  };
}

async function handleGetModelConfig(): Promise<APIGatewayProxyResult> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
  return {
    statusCode: 200,
    body: JSON.stringify({ modelId }),
  };
}

async function handleUpdateModelConfig(event: any): Promise<APIGatewayProxyResult> {
  const { modelId } = event.body ? JSON.parse(event.body) : {};
  if (!modelId || typeof modelId !== 'string') {
    return withCors({
      statusCode: 400,
      body: JSON.stringify({ code: 'INVALID_INPUT', message: 'modelId is required' }),
    });
  }
  // In a future iteration this would write to SSM. For now, acknowledge the request.
  return {
    statusCode: 200,
    body: JSON.stringify({ modelId }),
  };
}
