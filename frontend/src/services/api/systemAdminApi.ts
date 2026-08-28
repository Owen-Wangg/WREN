/**
 * System Admin (TechnicalAdmin) API calls — thin functions over the shared {@link HttpClient}.
 *
 * Scope is platform-wide administrative operations (TechAdmin only).
 * All responses validated with Zod schemas from @wren/types (frontend steering §7).
 */
import { z } from 'zod';
import {
  userSummarySchema,
  type UserSummary,
} from '@wren/types';
import type { HttpClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Path Constants */
/* -------------------------------------------------------------------------- */

const USERS_PATH = '/v1/users';
const ROLES_PATH = '/v1/roles';
const OVERRIDES_PATH = '/v1/overrides';
const USAGE_PATH = '/v1/usage';
const ANALYTICS_PATH = '/v1/analytics';

/* -------------------------------------------------------------------------- */
/* Reusable Response Schemas */
/* -------------------------------------------------------------------------- */

const usersSearchSchema = z.object({
  items: z.array(userSummarySchema),
  total: z.number().int().nonnegative(),
});

const overrideSchema = z.object({
  id: z.string(),
  userId: z.string(),
  documentTypeId: z.string(),
  bounds: z.object({
    additionalActions: z.number().int().nonnegative(),
  }),
  reason: z.string(),
  grantedBy: z.string(),
  expiresAt: z.string().datetime(),
});

const usageSchema = z.object({
  limit: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});

/* -------------------------------------------------------------------------- */
/* User Search (Platform-Wide) */
/* -------------------------------------------------------------------------- */

/**
 * Search all users on the platform (TechAdmin only).
 */
export async function searchAllUsers(
  client: HttpClient,
  options?: {
    q?: string;
    role?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{
  items: UserSummary[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.q) params.append('q', options.q);
  if (options?.role) params.append('role', options.role);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const path = queryString ? `${USERS_PATH}?${queryString}` : USERS_PATH;

  return client.request(path, {
    schema: usersSearchSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Role Assignment (TechAdmin Only) */
/* -------------------------------------------------------------------------- */

/**
 * Assign a role to a user (TechAdmin only).
 * If role is 'DepartmentAdmin', administeredDepartmentIds must be provided.
 */
export async function assignRole(
  client: HttpClient,
  userId: string,
  role: 'Student' | 'DepartmentAdmin' | 'TechnicalAdmin',
  administeredDepartmentIds?: string[],
): Promise<{
  userId: string;
  role: string;
}> {
  const body = {
    userId,
    role,
    ...(administeredDepartmentIds && { administeredDepartmentIds }),
  };

  const responseSchema = z.object({
    userId: z.string(),
    role: z.string(),
  });

  return client.request(ROLES_PATH, {
    method: 'POST',
    body,
    schema: responseSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Usage Overrides */
/* -------------------------------------------------------------------------- */

/**
 * Grant a temporary usage override for a user on a specific document type.
 */
export async function grantUsageOverride(
  client: HttpClient,
  userId: string,
  documentTypeId: string,
  additionalActions: number,
  reason: string,
  expiresAt: string,
): Promise<z.infer<typeof overrideSchema>> {
  const body = {
    userId,
    documentTypeId,
    bounds: { additionalActions },
    reason,
    expiresAt,
  };

  return client.request(OVERRIDES_PATH, {
    method: 'POST',
    body,
    schema: overrideSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Usage Information */
/* -------------------------------------------------------------------------- */

/**
 * Get usage information (platform-wide or scoped to a document type).
 */
export async function getUsageInfo(
  client: HttpClient,
  scope: 'platform' | 'documentType',
  scopeId?: string,
): Promise<{
  limit: number;
  consumed: number;
  remaining: number;
}> {
  const params = new URLSearchParams();
  params.append('scope', scope);
  if (scopeId) params.append('scopeId', scopeId);

  const queryString = params.toString();
  const path = `${USAGE_PATH}?${queryString}`;

  return client.request(path, {
    schema: usageSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Analytics (Platform-Wide) */
/* -------------------------------------------------------------------------- */

/**
 * Get platform-wide analytics (TechAdmin only).
 */
export async function getAnalyticsPlatform(
  client: HttpClient,
  documentTypeId?: string,
): Promise<Record<string, unknown>> {
  const path = documentTypeId
    ? `${ANALYTICS_PATH}?documentTypeId=${documentTypeId}`
    : ANALYTICS_PATH;

  const analyticsSchema = z.object({
    totals: z.array(
      z.object({
        scopeKind: z.enum(['platform', 'documentType']),
        scopeId: z.string().nullable().optional(),
        metric: z.string(),
        value: z.number(),
      }),
    ),
  });

  return client.request(path, {
    schema: analyticsSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Model Configuration (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Get current Bedrock model configuration (TechAdmin only).
 */
export async function getModelConfig(
  client: HttpClient,
): Promise<{ modelId: string }> {
  const schema = z.object({ modelId: z.string() });
  return client.request('/v1/admin/config/model', { schema });
}

/**
 * Update Bedrock model configuration (TechAdmin only).
 */
export async function updateModelConfig(
  client: HttpClient,
  modelId: string,
): Promise<{ modelId: string }> {
  const schema = z.object({ modelId: z.string() });
  return client.request('/v1/admin/config/model', {
    method: 'PUT',
    body: { modelId },
    schema,
  });
}

/* -------------------------------------------------------------------------- */
/* System Prompt Configuration (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Get system-level prompt/scaffolding (TechAdmin only).
 */
export async function getSystemPrompt(
  client: HttpClient,
): Promise<{ systemPrompt: string; scaffold: string }> {
  const schema = z.object({
    systemPrompt: z.string(),
    scaffold: z.string(),
  });
  return client.request('/v1/admin/config/prompt', { schema });
}

/**
 * Update system-level prompt/scaffolding (TechAdmin only).
 */
export async function updateSystemPrompt(
  client: HttpClient,
  systemPrompt: string,
  scaffold: string,
): Promise<{ systemPrompt: string; scaffold: string }> {
  const schema = z.object({
    systemPrompt: z.string(),
    scaffold: z.string(),
  });
  return client.request('/v1/admin/config/prompt', {
    method: 'PUT',
    body: { systemPrompt, scaffold },
    schema,
  });
}

/* -------------------------------------------------------------------------- */
/* Application Settings (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Get application name setting.
 */
export async function getAppName(
  client: HttpClient,
): Promise<{ appName: string }> {
  const schema = z.object({ appName: z.string() });
  return client.request('/v1/admin/config/app-name', { schema });
}

/**
 * Update application name setting (TechAdmin only).
 */
export async function updateAppName(
  client: HttpClient,
  appName: string,
): Promise<{ appName: string }> {
  const schema = z.object({ appName: z.string() });
  return client.request('/v1/admin/config/app-name', {
    method: 'PUT',
    body: { appName },
    schema,
  });
}

/* -------------------------------------------------------------------------- */
/* Usage Limits Configuration (Task 6.3) */
/* -------------------------------------------------------------------------- */

const platformUsageLimitsSchema = z.object({
  messageLimit: z.number().int().positive(),
  debriefGenerationLimit: z.number().int().positive(),
  documentUploadLimit: z.number().int().positive(),
  draftsPerDocumentLimit: z.number().int().positive(),
  maxUploadFileSizeBytes: z.number().int().min(1048576).max(1073741824),
});

/**
 * Get platform lifetime usage policy (TechnicalAdmin only).
 */
export async function getUsageLimits(
  client: HttpClient,
): Promise<z.infer<typeof platformUsageLimitsSchema>> {
  return client.request('/v1/admin/config/usage-limits', {
    schema: platformUsageLimitsSchema,
  });
}

/**
 * Update platform lifetime usage policy (TechnicalAdmin only).
 */
export async function setUsageLimit(
  client: HttpClient,
  limits: z.infer<typeof platformUsageLimitsSchema>,
): Promise<z.infer<typeof platformUsageLimitsSchema>> {
  return client.request('/v1/admin/config/usage-limits', {
    method: 'PUT',
    body: limits,
    schema: platformUsageLimitsSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Department Creation (Task 7.1) */
/* -------------------------------------------------------------------------- */

/**
 * Create a new Department (TechAdmin only).
 * Called as part of DepartmentAdmin appointment (auto-creates shell if not exists).
 */
export async function createDepartment(
  client: HttpClient,
  name: string,
): Promise<{ id: string; name: string }> {
  const schema = z.object({
    id: z.string(),
    name: z.string(),
  });
  return client.request('/v1/admin/departments', {
    method: 'POST',
    body: { name },
    schema,
  });
}

/* -------------------------------------------------------------------------- */
/* Bedrock Models (Task 8 - Model Config) */
/* -------------------------------------------------------------------------- */

/**
 * List available Bedrock models for selection.
 */
export async function listBedrockModels(
  client: HttpClient,
): Promise<Array<{ id: string; name: string; description?: string }>> {
  const schema = z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  );
  return client.request('/v1/admin/bedrock-models', { schema });
}

/* -------------------------------------------------------------------------- */
/* Usage Limits Enforcement (Task 8.1) */
/* -------------------------------------------------------------------------- */

/**
 * Check if usage limit would be exceeded for a document type.
 * Returns { allowed: boolean, remainingBefore: number, scope: string }
 */
export async function checkUsageLimitExceeded(
  client: HttpClient,
  documentTypeId: string,
): Promise<{
  allowed: boolean;
  remainingBefore: number;
  scope: 'platform' | 'documentType';
}> {
  const schema = z.object({
    allowed: z.boolean(),
    remainingBefore: z.number(),
    scope: z.enum(['platform', 'documentType']),
  });
  return client.request(
    `/v1/usage/check?documentTypeId=${documentTypeId}`,
    { schema },
  );
}

/**
 * Get current usage for a specific scope.
 * Returns { used: number, limit: number, remaining: number }
 */
export async function getCurrentUsage(
  client: HttpClient,
  scope: 'platform' | 'documentType',
  scopeId?: string,
): Promise<{
  used: number;
  limit: number;
  remaining: number;
}> {
  const params = new URLSearchParams();
  params.append('scope', scope);
  if (scopeId) params.append('scopeId', scopeId);

  const schema = z.object({
    used: z.number(),
    limit: z.number(),
    remaining: z.number(),
  });

  return client.request(
    `/v1/usage?${params.toString()}`,
    { schema },
  );
}

/**
 * Record a feedback generation action for audit logging.
 * Called when feedback is generated (Task 8.1, REQ-ACTIVITY-LOG-01).
 */
export async function logFeedbackGeneration(
  client: HttpClient,
  input: {
    documentTypeId: string;
    userId: string;
    scope: 'platform' | 'documentType';
    timestamp: string;
  },
): Promise<{ logged: boolean }> {
  const schema = z.object({ logged: z.boolean() });
  return client.request(
    '/v1/admin/audit/feedback-generation',
    {
      method: 'POST',
      body: input,
      schema,
    },
  );
}
