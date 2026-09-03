/**
 * System Admin (TechnicalAdmin) API — unified `/v1/*` routes via shared HttpClient.
 *
 * All calls route through `apiClient` with Cognito auth + Zod validation at boundary.
 * Responses validated against `@wren/types` schemas (frontend steering §7).
 */
import { z } from 'zod';
import {
  departmentSchema,
  departmentVisibilityGrantSchema,
  departmentVisibilityPermissionListSchema,
  userSummarySchema,
  type DepartmentVisibilityState,
} from '@wren/types';
import { apiClient } from '@/services';
import { usageLimitsSchema, type UsageLimits } from './systemAdminSchemas';

export type { UsageLimits };
export { usageLimitsSchema };

/* -------------------------------------------------------------------------- */
/* Analytics — platform-wide aggregates */
/* -------------------------------------------------------------------------- */

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

export async function getAnalytics() {
  return apiClient.request('/v1/analytics', { schema: analyticsSchema });
}

const analyticsSummarySchema = z.object({
  totalDocuments: z.number(),
  totalDrafts: z.number(),
  activeUsers: z.number(),
  breakdownByDocumentType: z.array(z.object({
    id: z.string(),
    name: z.string(),
    feedbackGenerated: z.number(),
  })),
  platformUsageOverTime: z.array(z.object({
    month: z.string(),
    feedbackGenerated: z.number(),
  })),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

export async function getAnalyticsSummary(departmentId?: string) {
  const path = departmentId
    ? `/v1/analytics/summary?departmentId=${departmentId}`
    : '/v1/analytics/summary';
  return apiClient.request(path, { schema: analyticsSummarySchema });
}

/* -------------------------------------------------------------------------- */
/* Departments — platform-wide management (TechAdmin only) */
/* -------------------------------------------------------------------------- */

export async function listDepartments() {
  return apiClient.request('/v1/departments', { schema: z.array(departmentSchema) });
}

export async function createDepartment(name: string) {
  return apiClient.request('/v1/departments', {
    method: 'POST',
    body: { name },
    schema: departmentSchema,
  });
}

export async function getDepartment(departmentId: string) {
  return apiClient.request(`/v1/departments/${departmentId}`, { schema: departmentSchema });
}

export async function updateDepartmentPrompt(departmentId: string, prompt: string | null) {
  return apiClient.request(`/v1/departments/${departmentId}/prompt`, {
    method: 'PUT',
    body: { prompt },
    schema: departmentSchema,
  });
}

export async function deleteDepartment(departmentId: string) {
  return apiClient.request(`/v1/departments/${departmentId}`, {
    method: 'DELETE',
    schema: departmentSchema,
  });
}

export async function setDepartmentAccessState(
  departmentId: string,
  accessState: 'OPEN' | 'LOCKED',
) {
  return apiClient.request(`/v1/departments/${departmentId}/access-state`, {
    method: 'PUT',
    body: { accessState },
    schema: departmentSchema,
  });
}

export async function setDepartmentVisibilityState(
  departmentId: string,
  visibilityState: DepartmentVisibilityState,
) {
  return apiClient.request(`/v1/departments/${departmentId}/visibility-state`, {
    method: 'PUT',
    body: { visibilityState },
    schema: departmentSchema,
  });
}

export async function listDepartmentVisibilityGrants(
  departmentId: string,
  options?: { q?: string; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  if (options?.q) params.append('q', options.q);
  if (options?.limit !== undefined) params.append('limit', String(options.limit));
  if (options?.offset !== undefined) params.append('offset', String(options.offset));
  const queryString = params.toString();
  return apiClient.request(
    `/v1/departments/${departmentId}/visibility-grants${queryString ? `?${queryString}` : ''}`,
    { schema: departmentVisibilityPermissionListSchema },
  );
}

export async function createDepartmentVisibilityGrant(
  departmentId: string,
  userId: string,
) {
  return apiClient.request(`/v1/departments/${departmentId}/visibility-grants`, {
    method: 'POST',
    body: { userId },
    schema: departmentVisibilityGrantSchema,
  });
}

export async function revokeDepartmentVisibilityGrant(
  departmentId: string,
  grantId: string,
) {
  return apiClient.request(
    `/v1/departments/${departmentId}/visibility-grants/${grantId}`,
    { method: 'DELETE', schema: departmentVisibilityGrantSchema },
  );
}

/* -------------------------------------------------------------------------- */
/* Users — platform-wide search (TechAdmin only) */
/* -------------------------------------------------------------------------- */

const usersSearchSchema = z.object({
  users: z.array(userSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export async function searchAllUsers(options?: {
  q?: string;
  role?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options?.q) params.append('q', options.q);
  if (options?.role) params.append('role', options.role);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const path = queryString ? `/v1/users?${queryString}` : '/v1/users';

  const result = await apiClient.request(path, { schema: usersSearchSchema });
  // Normalize to a consistent shape for consumers
  return { items: result.users, total: result.total };
}

const departmentUsersSchema = z.object({
  users: z.array(z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  })),
  total: z.number().int().nonnegative(),
});

/** Fetch users who have submitted at least one document in a specific department. */
export async function getDepartmentUsers(
  departmentId: string,
  options?: { q?: string; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  if (options?.q) params.append('q', options.q);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));
  const qs = params.toString();
  const path = `/v1/departments/${departmentId}/users${qs ? `?${qs}` : ''}`;
  const result = await apiClient.request(path, { schema: departmentUsersSchema });
  return { items: result.users, total: result.total };
}

/* -------------------------------------------------------------------------- */
/* Usage — platform-wide report + lifetime policy config */
/* -------------------------------------------------------------------------- */

const usageReportSchema = z
  .object({
    scope: z.union([
      z.object({ kind: z.literal('platform') }),
      z.object({ kind: z.literal('documentType'), documentTypeId: z.string() }),
    ]),
    limitValue: z.number().int().nonnegative(),
    consumed: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    periodStart: z.string(),
  })
  .nullable();

export async function getUsageReport(scope: 'platform' | string = 'platform', periodStart?: string) {
  const params = new URLSearchParams();
  params.append('scope', scope);
  if (periodStart) params.append('periodStart', periodStart);
  return apiClient.request(`/v1/usage?${params}`, { schema: usageReportSchema });
}

export async function getPlatformUsageLimits(): Promise<UsageLimits> {
  return apiClient.request('/v1/admin/config/usage-limits', {
    schema: usageLimitsSchema,
  });
}

export async function updatePlatformUsageLimits(limits: UsageLimits): Promise<UsageLimits> {
  return apiClient.request('/v1/admin/config/usage-limits', {
    method: 'PUT',
    body: limits,
    schema: usageLimitsSchema,
  });
}

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

export async function grantUsageOverride(input: {
  userId: string;
  documentTypeId: string;
  bounds: { additionalActions: number };
  reason: string;
  expiresAt: string;
}) {
  return apiClient.request('/v1/overrides', {
    method: 'POST',
    body: input,
    schema: overrideSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Roles — platform-wide role assignment (TechAdmin only) */
/* -------------------------------------------------------------------------- */

export async function assignRole(input: {
  userId: string;
  role: 'Student' | 'DepartmentAdmin' | 'TechnicalAdmin';
  departmentId?: string;
}) {
  return apiClient.request('/v1/roles', {
    method: 'POST',
    body: {
      userId: input.userId,
      role: input.role,
      scope: input.departmentId
        ? { kind: 'department', departmentId: input.departmentId }
        : { kind: 'platform' },
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  });
}

export async function revokeRole(input: {
  userId: string;
  role: 'Student' | 'DepartmentAdmin' | 'TechnicalAdmin';
  departmentId?: string;
}) {
  return apiClient.request('/v1/roles', {
    method: 'DELETE',
    body: {
      userId: input.userId,
      role: input.role,
      scope: input.departmentId
        ? { kind: 'department', departmentId: input.departmentId }
        : { kind: 'platform' },
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Model Configuration — read-only deploy-time value */
/* -------------------------------------------------------------------------- */

const allowedModelSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const modelConfigSchema = z.object({
  modelId: z.string(),
  writable: z.boolean().optional(),
  note: z.string().optional(),
  allowedModels: z.array(allowedModelSchema).optional(),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export async function getModelConfig() {
  return apiClient.request('/v1/admin/config/model', { schema: modelConfigSchema });
}

/**
 * Runtime model updates are not implemented (API returns 501).
 * Kept for callers that need to surface the not-implemented response.
 */
export async function updateModelConfig(modelId: string) {
  return apiClient.request('/v1/admin/config/model', {
    method: 'PUT',
    body: { modelId },
    schema: modelConfigSchema,
  });
}

/* Unified API object for consistency with other API modules */
export const systemAdminApi = {
  getAnalytics,
  listDepartments,
  getDepartment,
  deleteDepartment,
  updateDepartmentPrompt,
  setDepartmentAccessState,
  setDepartmentVisibilityState,
  listDepartmentVisibilityGrants,
  createDepartmentVisibilityGrant,
  revokeDepartmentVisibilityGrant,
  searchAllUsers,
  getUsageReport,
  getPlatformUsageLimits,
  updatePlatformUsageLimits,
  grantUsageOverride,
  assignRole,
  revokeRole,
  getModelConfig,
  updateModelConfig,
};
