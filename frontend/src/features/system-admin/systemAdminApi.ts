/**
 * System Admin (TechnicalAdmin) API — unified `/v1/*` routes via shared HttpClient.
 *
 * All calls route through `apiClient` with Cognito auth + Zod validation at boundary.
 * Responses validated against `@wren/types` schemas (frontend steering §7).
 */
import { z } from 'zod';
import { departmentSchema, userSummarySchema } from '@wren/types';
import { apiClient } from '@/services';

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

/* -------------------------------------------------------------------------- */
/* Usage — platform-wide report (read-only; configure via dedicated APIs later) */
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

/* -------------------------------------------------------------------------- */
/* Model Configuration — read-only deploy-time value */
/* -------------------------------------------------------------------------- */

const modelConfigSchema = z.object({
  modelId: z.string(),
  writable: z.boolean().optional(),
  note: z.string().optional(),
});

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
  searchAllUsers,
  getUsageReport,
  grantUsageOverride,
  assignRole,
  getModelConfig,
  updateModelConfig,
};
