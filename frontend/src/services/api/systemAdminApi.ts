/**
 * System Admin (TechnicalAdmin) API calls — thin functions over the shared {@link HttpClient}.
 *
 * Scope is platform-wide administrative operations (TechAdmin only).
 * All responses validated with Zod schemas from @wren/types (frontend steering §7).
 */
import { z } from 'zod';
import {
  roleSchema,
  userSummarySchema,
  type User,
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
  items: User[];
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
): Promise<(typeof overrideSchema)._type> {
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
