/**
 * Department Admin API calls — thin functions over the shared {@link HttpClient}.
 *
 * Scope is department-scoped operations for DepartmentAdmins.
 * All responses validated with Zod schemas from @wren/types (frontend steering §7).
 */
import { z } from 'zod';
import {
  departmentSchema,
  documentTypeSchema,
  documentTypeConfigSchema,
  accessGrantSchema,
  userSummarySchema,
  type Department,
  type DocumentType,
  type User,
  type AccessGrant,
} from '@wren/types';
import type { HttpClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Path Constants */
/* -------------------------------------------------------------------------- */

const DEPARTMENTS_PATH = '/v1/departments';
const DOCUMENT_TYPES_PATH = '/v1/document-types';
const USERS_PATH = '/v1/users';
const ANALYTICS_PATH = '/v1/analytics';

/* -------------------------------------------------------------------------- */
/* Reusable Response Schemas */
/* -------------------------------------------------------------------------- */

const departmentsListSchema = z.array(departmentSchema);
const documentTypesListSchema = z.array(documentTypeSchema);
const documentTypeConfigSchema = z.object({
  documentTypeId: z.string(),
  tone: z.string().nullable().optional(),
  density: z.string().nullable().optional(),
  categoryPriority: z.array(z.string()).optional(),
  promptText: z.string().nullable().optional(),
});

const usersSearchSchema = z.object({
  items: z.array(userSummarySchema),
  total: z.number().int().nonnegative(),
});

/* -------------------------------------------------------------------------- */
/* Department Operations */
/* -------------------------------------------------------------------------- */

/**
 * List departments visible to the authenticated user
 * (scoped by role: DepartmentAdmin sees administered depts, TechAdmin sees all).
 */
export async function listDepartments(client: HttpClient): Promise<Department[]> {
  return client.request(DEPARTMENTS_PATH, {
    schema: departmentsListSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Document Type Operations */
/* -------------------------------------------------------------------------- */

/**
 * List document types, optionally filtered by department.
 */
export async function listDocumentTypes(
  client: HttpClient,
  departmentId?: string,
): Promise<DocumentType[]> {
  const path = departmentId
    ? `${DOCUMENT_TYPES_PATH}?departmentId=${departmentId}`
    : DOCUMENT_TYPES_PATH;

  return client.request(path, {
    schema: documentTypesListSchema,
  });
}

/**
 * Get Document Type configuration (tone, density, prompt, category priority).
 * DepartmentAdmins must administer the department; TechAdmins can access any.
 */
export async function getDocumentTypeConfig(
  client: HttpClient,
  documentTypeId: string,
): Promise<Record<string, unknown>> {
  return client.request(`${DOCUMENT_TYPES_PATH}/${documentTypeId}/config`, {
    schema: documentTypeConfigSchema,
  });
}

/**
 * Update Document Type configuration.
 */
export async function updateDocumentTypeConfig(
  client: HttpClient,
  documentTypeId: string,
  updates: {
    tone?: string | null;
    density?: string | null;
    promptText?: string | null;
    categoryPriority?: string[];
  },
): Promise<Record<string, unknown>> {
  return client.request(`${DOCUMENT_TYPES_PATH}/${documentTypeId}/config`, {
    method: 'PUT',
    body: updates,
    schema: documentTypeConfigSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* User Search (Department-Scoped) */
/* -------------------------------------------------------------------------- */

/**
 * Search users scoped to administered departments (for DepartmentAdmins).
 * TechAdmins can search globally.
 */
export async function searchUsers(
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
/* Access Grant Operations */
/* -------------------------------------------------------------------------- */

/**
 * Grant a user access to a LOCKED document type.
 */
export async function grantAccessToUser(
  client: HttpClient,
  userId: string,
  documentTypeId: string,
): Promise<AccessGrant> {
  const body = { userId, documentTypeId };
  return client.request('/v1/access-grants', {
    method: 'POST',
    body,
    schema: accessGrantSchema,
  });
}

/**
 * Revoke an access grant.
 */
export async function revokeAccessGrant(
  client: HttpClient,
  grantId: string,
): Promise<void> {
  await client.request(`/v1/access-grants/${grantId}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}

/* -------------------------------------------------------------------------- */
/* Analytics (Department-Scoped) */
/* -------------------------------------------------------------------------- */

/**
 * Get analytics scoped to administered document types.
 * DepartmentAdmins see their depts' data; TechAdmins see all.
 */
export async function getAnalytics(
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
