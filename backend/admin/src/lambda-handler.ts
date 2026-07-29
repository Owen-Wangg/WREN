/**
 * Admin Service Lambda entry point — routes API Gateway events to service functions.
 * Handles: departments, document-types, users, roles, usage, overrides, and /v1/auth/me.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';
import { listDepartments, getDepartment, createDepartment, updateDepartmentPrompt, setDepartmentAccessState, listDepartmentUsers } from './departmentService';
import {
  listDocumentTypes,
  listAllDocumentTypes,
  createDocumentType,
  setDocumentTypeAccessState,
} from './documentTypeService';
import { listErrorCategories, createErrorCategory, updateErrorCategory, deleteErrorCategory } from './errorCategoryService';
import { getDocumentTypeConfig, upsertDocumentTypeConfig } from './documentTypeConfigService';
import { listContentTypes } from './contentTypeService';
import { searchUsers } from './userService';
import { assignRole, revokeRole } from './roleAssignmentService';
import { getUsageReport } from './usageLimitService';
import { grantOverride } from './overrideService';
import { listMyAccessGrants } from './accessGrantService';
import { getAnalytics, getImprovementTrends } from './analyticsService';
import { BedrockClient, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { getHelpfulnessAnalytics } from './helpfulnessAnalyticsService';
import {
  getPlatformUsagePolicyForAdmin,
  updatePlatformUsagePolicy,
} from './lifetimeUsagePolicy';
import { parseAuthContext, wrapHandler, withCors } from './lambda-utils';
import { AuthorizationError } from './errors';
import { requireCapability } from './capabilityGuard';
import { handler as syncCognitoAdminsHandler } from './scripts/sync-cognito-admins';
import type { AuthContext } from '@wren/types';

/** TechnicalAdmin-only gate for endpoints without a dedicated capability. */
function requireTechnicalAdmin(actor: AuthContext): void {
  if (!actor.roles.includes('TechnicalAdmin')) {
    throw new AuthorizationError('TechnicalAdmin role required');
  }
}

/** UTC start of the current calendar month — matches how usage counters are keyed. */
function currentUtcMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
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
      return await wrapHandler(() => handleListDepartments(event));
    }
    if (resource === '/v1/departments' && httpMethod === 'POST') {
      return await wrapHandler(() => handleCreateDepartment(event));
    }
    if (resource === '/v1/departments/{departmentId}' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetDepartment(event));
    }
    if (resource === '/v1/departments/{departmentId}/users' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListDepartmentUsers(event));
    }
    if (resource === '/v1/departments/{departmentId}/prompt' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleUpdateDepartmentPrompt(event));
    }
    if (resource === '/v1/departments/{departmentId}/access-state' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleSetDepartmentAccessState(event));
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
    if (resource === '/v1/document-types/{documentTypeId}/error-categories' && httpMethod === 'GET') {
      return await wrapHandler(() => handleListErrorCategories(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/error-categories' && httpMethod === 'POST') {
      return await wrapHandler(() => handleCreateErrorCategory(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/error-categories/{categoryId}' && httpMethod === 'PATCH') {
      return await wrapHandler(() => handleUpdateErrorCategory(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/error-categories/{categoryId}' && httpMethod === 'DELETE') {
      return await wrapHandler(() => handleDeleteErrorCategory(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/config' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetDocumentTypeConfig(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/config' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleUpdateDocumentTypeConfig(event));
    }
    if (resource === '/v1/document-types/{documentTypeId}/access-state' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleSetDocumentTypeAccessState(event));
    }
    if (resource === '/v1/users' && httpMethod === 'GET') {
      return await wrapHandler(() => handleSearchUsers(event));
    }
    if (resource === '/v1/roles' && httpMethod === 'POST') {
      return await wrapHandler(() => handleAssignRole(event));
    }
    if (resource === '/v1/roles' && httpMethod === 'DELETE') {
      return await wrapHandler(() => handleRevokeRole(event));
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
    if (resource === '/v1/analytics/feedback-helpfulness' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetHelpfulnessAnalytics(event));
    }
    if (resource === '/v1/analytics/improvement-trends' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetImprovementTrends(event));
    }
    if (resource === '/v1/analytics/summary' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetAnalyticsSummary(event));
    }
    if (resource === '/v1/admin/config/model' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetModelConfig(event));
    }
    if (resource === '/v1/admin/config/model' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleUpdateModelConfig(event));
    }
    if (resource === '/v1/admin/config/usage-limits' && httpMethod === 'GET') {
      return await wrapHandler(() => handleGetUsageLimits(event));
    }
    if (resource === '/v1/admin/config/usage-limits' && httpMethod === 'PUT') {
      return await wrapHandler(() => handleUpdateUsageLimits(event));
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

async function handleListDepartments(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const departments = await listDepartments(db);
  // The department `prompt` field is a TechnicalAdmin-authored system instruction
  // injected into Bedrock prompts. Strip it for non-TechnicalAdmin callers so that
  // DeptAdmins and Students cannot enumerate another department's prompt content.
  const isTechAdmin = actor.roles.includes('TechnicalAdmin');
  const sanitized = departments.map((d: any) =>
    isTechAdmin ? d : { ...d, prompt: undefined },
  );
  return {
    statusCode: 200,
    body: JSON.stringify(sanitized),
  };
}

async function handleGetDepartment(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { departmentId } = event.pathParameters || {};
  const department = await getDepartment(departmentId, db);
  if (!department) {
    throw Object.assign(new Error('Department not found'), { statusCode: 404 });
  }
  const isTechAdmin = actor.roles.includes('TechnicalAdmin');
  const response = isTechAdmin ? department : { ...department, prompt: undefined };
  return {
    statusCode: 200,
    body: JSON.stringify(response),
  };
}

async function handleListDocumentTypes(event: any): Promise<APIGatewayProxyResult> {
  parseAuthContext(event); // ensure the request is authenticated before returning catalog data
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
  parseAuthContext(event); // ensure the request is authenticated before returning catalog data
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

async function handleSetDocumentTypeAccessState(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const accessState = body.accessState as 'OPEN' | 'LOCKED' | undefined;
  if (accessState !== 'OPEN' && accessState !== 'LOCKED') {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: "accessState must be 'OPEN' or 'LOCKED'",
      }),
    };
  }
  const updated = await setDocumentTypeAccessState(actor, documentTypeId, accessState, db);
  return {
    statusCode: 200,
    body: JSON.stringify({ accessState: updated.accessState }),
  };
}

async function handleSetDepartmentAccessState(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { departmentId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const accessState = body.accessState as 'OPEN' | 'LOCKED' | undefined;
  if (accessState !== 'OPEN' && accessState !== 'LOCKED') {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: "accessState must be 'OPEN' or 'LOCKED'",
      }),
    };
  }
  const updated = await setDepartmentAccessState(actor, departmentId, accessState, db);
  return {
    statusCode: 200,
    body: JSON.stringify(updated),
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
    body: JSON.stringify({ success: true, userId: body.userId, role: body.role }),
  };
}

async function handleRevokeRole(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  await revokeRole(actor, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, userId: body.userId, role: body.role }),
  };
}

async function handleGetUsage(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  requireCapability(actor, {
    capability: 'usageLimit.configure',
    scope: { kind: 'platform' },
  });

  const db = await getDataAccess();
  const { scope, periodStart } = event.queryStringParameters || {};

  const scopeParam = scope ?? 'platform';
  const scopeObj =
    scopeParam === 'platform'
      ? { kind: 'platform' as const }
      : { kind: 'documentType' as const, documentTypeId: scopeParam };

  if (scopeObj.kind === 'documentType' && !scopeObj.documentTypeId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'documentType scope requires a document type id',
      }),
    };
  }

  const periodStartDate = periodStart ? new Date(periodStart) : currentUtcMonthStart();
  if (Number.isNaN(periodStartDate.getTime())) {
    return {
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'Invalid periodStart' }),
    };
  }

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

async function handleGetImprovementTrends(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.queryStringParameters || {};
  if (!documentTypeId) {
    return { statusCode: 400, body: JSON.stringify({ code: 'BAD_REQUEST', message: 'documentTypeId is required' }) };
  }
  const result = await getImprovementTrends(actor, documentTypeId, db);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

async function handleGetAnalyticsSummary(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  requireTechnicalAdmin(actor);
  const db = await getDataAccess();
  const { departmentId } = event.queryStringParameters || {};

  // Get document type IDs scoped to this department (or all if no filter)
  const docTypeRows = await db.query<{ id: string; name: string }>(
    departmentId
      ? `SELECT id, name FROM document_type WHERE department_id = $1 ORDER BY name ASC`
      : `SELECT id, name FROM document_type ORDER BY name ASC`,
    departmentId ? [departmentId] : [],
  );
  const docTypeIds = docTypeRows.map((r) => r.id);

  const docTypeFilterAgg = docTypeIds.length > 0
    ? `AND scope_id = ANY($1)`
    : `AND FALSE`;

  const [[docRow], [draftRow], [userRow], feedbackByDocType, feedbackByMonth] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM document${docTypeIds.length > 0 ? ` WHERE document_type_id = ANY($1)` : ''}`,
      docTypeIds.length > 0 ? [docTypeIds] : [],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM draft d
       JOIN document doc ON doc.id = d.document_id
       ${docTypeIds.length > 0 ? `WHERE doc.document_type_id = ANY($1)` : ''}`,
      docTypeIds.length > 0 ? [docTypeIds] : [],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT ra.user_id) AS count
       FROM role_assignment ra
       WHERE ra.role = 'Student'`,
    ),
    db.query<{ scope_id: string; value: string }>(
      `SELECT scope_id, SUM(value)::int AS value
       FROM aggregate_counter
       WHERE scope_kind = 'documentType' AND metric = 'feedback_items_generated'
       ${docTypeIds.length > 0 ? docTypeFilterAgg : ''}
       GROUP BY scope_id`,
      docTypeIds.length > 0 ? [docTypeIds] : [],
    ),
    db.query<{ month: string; value: string }>(
      `SELECT to_char(window_start, 'Mon YYYY') AS month,
              date_trunc('month', window_start) AS month_ts,
              SUM(value)::int AS value
       FROM aggregate_counter
       WHERE metric = 'feedback_items_generated'
       ${docTypeIds.length > 0 ? docTypeFilterAgg : ''}
       GROUP BY to_char(window_start, 'Mon YYYY'), date_trunc('month', window_start)
       ORDER BY date_trunc('month', window_start) ASC`,
      docTypeIds.length > 0 ? [docTypeIds] : [],
    ),
  ]);

  const feedbackByDocTypeMap: Record<string, number> = {};
  for (const r of feedbackByDocType) {
    feedbackByDocTypeMap[r.scope_id] = parseInt(r.value, 10);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      totalDocuments: parseInt(docRow?.count ?? '0', 10),
      totalDrafts: parseInt(draftRow?.count ?? '0', 10),
      activeUsers: parseInt(userRow?.count ?? '0', 10),
      breakdownByDocumentType: docTypeRows.map((dt) => ({
        id: dt.id,
        name: dt.name,
        feedbackGenerated: feedbackByDocTypeMap[dt.id] ?? 0,
      })),
      platformUsageOverTime: feedbackByMonth.map((r: any) => ({
        month: r.month,
        feedbackGenerated: parseInt(r.value, 10),
      })),
    }),
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

async function handleListDepartmentUsers(event: any): Promise<APIGatewayProxyResult> {
  parseAuthContext(event);
  const db = await getDataAccess();
  const { departmentId } = event.pathParameters || {};
  const qs = event.queryStringParameters || {};
  const result = await listDepartmentUsers(departmentId, db, {
    q: qs.q,
    limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
    offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
  });
  return { statusCode: 200, body: JSON.stringify(result) };
}

async function handleUpdateDepartmentPrompt(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { departmentId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const department = await updateDepartmentPrompt(actor, departmentId, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify(department),
  };
}

async function handleListErrorCategories(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.pathParameters || {};
  const categories = await listErrorCategories(documentTypeId, db);
  // internalGuidance is a Feedback Engine prompt-assembly detection aid that
  // MUST NEVER be surfaced to Students (REQ-TAXONOMY-01 / Requirement 15.4).
  // Only TechnicalAdmins and DeptAdmins who administer this document type's
  // department receive the full DTO; all other callers get name+id only.
  const isTechAdmin = actor.roles.includes('TechnicalAdmin');
  const isDeptAdminForType =
    !isTechAdmin &&
    actor.administeredDepartmentIds?.length > 0 &&
    categories.length > 0;

  let canSeeGuidance = isTechAdmin;
  if (!canSeeGuidance && isDeptAdminForType) {
    // Verify this actor administers the department that owns this document type.
    const deptRows = await db.query<{ department_id: string }>(
      'SELECT department_id FROM document_type WHERE id = $1',
      [documentTypeId],
    );
    const owningDeptId = deptRows[0]?.department_id;
    canSeeGuidance = !!owningDeptId && (actor.administeredDepartmentIds ?? []).includes(owningDeptId);
  }

  const response = canSeeGuidance
    ? categories
    : categories.map(({ internalGuidance: _stripped, ...safe }: any) => safe);

  return {
    statusCode: 200,
    body: JSON.stringify(response),
  };
}

async function handleCreateErrorCategory(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const category = await createErrorCategory(actor, { ...body, documentTypeId }, db);
  return {
    statusCode: 201,
    body: JSON.stringify(category),
  };
}

async function handleUpdateErrorCategory(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { categoryId } = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const category = await updateErrorCategory(actor, categoryId, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify(category),
  };
}

async function handleDeleteErrorCategory(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { categoryId } = event.pathParameters || {};
  await deleteErrorCategory(actor, categoryId, db);
  return {
    statusCode: 204,
    body: '',
  };
}

let cachedAllowedModels: { id: string; label: string }[] | null = null;

async function fetchAllowedModels(): Promise<{ id: string; label: string }[]> {
  if (cachedAllowedModels) return cachedAllowedModels;

  try {
    const client = new BedrockClient({ region: process.env.AWS_REGION ?? 'ca-central-1' });

    // Cross-region inference profiles (us.anthropic.*, us.meta.*) are what the
    // engine actually invokes — ListInferenceProfiles returns these IDs.
    const response = await client.send(new ListInferenceProfilesCommand({
      typeEquals: 'SYSTEM_DEFINED',
    }));

    const models = (response.inferenceProfileSummaries ?? [])
      .filter((p) => {
        const id = p.inferenceProfileId?.toLowerCase() ?? '';
        return id.startsWith('us.anthropic.') || id.startsWith('us.meta.');
      })
      .filter((p) => p.inferenceProfileId && p.inferenceProfileName)
      .map((p) => ({
        id: p.inferenceProfileId!,
        label: p.inferenceProfileName!,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    cachedAllowedModels = models.length > 0 ? models : FALLBACK_MODELS;
    return cachedAllowedModels;
  } catch (err) {
    console.warn('Failed to list Bedrock inference profiles, using fallback list:', err);
    return FALLBACK_MODELS;
  }
}

// Fallback in case Bedrock ListFoundationModels is unavailable or returns nothing.
const FALLBACK_MODELS = [
  { id: 'us.anthropic.claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — Anthropic' },
  { id: 'us.anthropic.claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 — Anthropic' },
  { id: 'us.anthropic.claude-opus-4-8',            label: 'Claude Opus 4.8 — Anthropic' },
  { id: 'us.anthropic.claude-sonnet-5',            label: 'Claude Sonnet 5 — Anthropic' },
];

async function handleGetModelConfig(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  requireTechnicalAdmin(actor);

  const db = await getDataAccess();
  const rows = await db.query<{ bedrock_model_id: string | null }>(
    'SELECT bedrock_model_id FROM platform_usage_policy WHERE id = 1',
  );
  const dbModelId = rows[0]?.bedrock_model_id ?? null;
  const envModelId = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
  const modelId = dbModelId ?? envModelId;

  const allowedModels = await fetchAllowedModels();

  return {
    statusCode: 200,
    body: JSON.stringify({
      modelId,
      writable: true,
      allowedModels,
    }),
  };
}

async function handleGetHelpfulnessAnalytics(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const { documentTypeId } = event.queryStringParameters || {};
  if (!documentTypeId) {
    return withCors({
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'documentTypeId query parameter is required' }),
    });
  }
  const result = await getHelpfulnessAnalytics(actor, documentTypeId, db);
  return withCors({ statusCode: 200, body: JSON.stringify(result) });
}

async function handleUpdateModelConfig(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  requireTechnicalAdmin(actor);

  const body = event.body ? JSON.parse(event.body) : {};
  const { modelId } = body;

  if (!modelId || typeof modelId !== 'string') {
    return withCors({
      statusCode: 400,
      body: JSON.stringify({ code: 'BAD_REQUEST', message: 'modelId is required' }),
    });
  }

  const allowedModels = await fetchAllowedModels();
  const allowed = allowedModels.map((m) => m.id);
  if (!allowed.includes(modelId)) {
    return withCors({
      statusCode: 400,
      body: JSON.stringify({
        code: 'BAD_REQUEST',
        message: `Model '${modelId}' is not in the allowed list.`,
      }),
    });
  }

  const db = await getDataAccess();
  await db.query(
    'UPDATE platform_usage_policy SET bedrock_model_id = $1 WHERE id = 1',
    [modelId],
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      modelId,
      writable: true,
      allowedModels,
    }),
  };
}

async function handleGetUsageLimits(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const policy = await getPlatformUsagePolicyForAdmin(actor, db);
  return {
    statusCode: 200,
    body: JSON.stringify(policy),
  };
}

async function handleUpdateUsageLimits(event: any): Promise<APIGatewayProxyResult> {
  const actor = parseAuthContext(event);
  const db = await getDataAccess();
  const body = event.body ? JSON.parse(event.body) : {};
  const policy = await updatePlatformUsagePolicy(actor, body, db);
  return {
    statusCode: 200,
    body: JSON.stringify(policy),
  };
}
