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
  accessGrantSchema,
  userSummarySchema,
  type Department,
  type DocumentType,
  type UserSummary,
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

/* -------------------------------------------------------------------------- */
/* Document Type CRUD (Task 7.1) */
/* -------------------------------------------------------------------------- */

export async function createDocumentType(
  client: HttpClient,
  departmentId: string,
  input: {
    name: string;
    description?: string;
  },
) {
  return client.request(
    `/v1/departments/${departmentId}/document-types`,
    {
      method: 'POST',
      body: input,
      schema: documentTypeSchema,
    },
  );
}

export async function deleteDocumentType(
  client: HttpClient,
  documentTypeId: string,
) {
  return client.request(
    `/v1/document-types/${documentTypeId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Content Types (Task 7.2) */
/* -------------------------------------------------------------------------- */

const contentTypeSchema = z.object({
  id: z.string(),
  documentTypeId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

export async function listContentTypes(
  client: HttpClient,
  documentTypeId: string,
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/content-types`,
    { schema: z.array(contentTypeSchema) },
  );
}

export async function createContentType(
  client: HttpClient,
  documentTypeId: string,
  input: {
    name: string;
    description?: string;
  },
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/content-types`,
    {
      method: 'POST',
      body: input,
      schema: contentTypeSchema,
    },
  );
}

export async function deleteContentType(
  client: HttpClient,
  documentTypeId: string,
  contentTypeId: string,
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/content-types/${contentTypeId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Metadata Fields (Task 7.2) */
/* -------------------------------------------------------------------------- */

const metadataFieldSchema = z.object({
  id: z.string(),
  documentTypeId: z.string(),
  name: z.string(),
  required: z.boolean(),
  fieldType: z.enum(['text', 'select', 'multiselect', 'date']),
  options: z.array(z.string()).nullable(),
});

export async function listMetadataFields(
  client: HttpClient,
  documentTypeId: string,
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/metadata-fields`,
    { schema: z.array(metadataFieldSchema) },
  );
}

export async function createMetadataField(
  client: HttpClient,
  documentTypeId: string,
  input: {
    name: string;
    required: boolean;
    fieldType: 'text' | 'select' | 'multiselect' | 'date';
    options?: string[];
  },
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/metadata-fields`,
    {
      method: 'POST',
      body: input,
      schema: metadataFieldSchema,
    },
  );
}

export async function deleteMetadataField(
  client: HttpClient,
  documentTypeId: string,
  fieldId: string,
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/metadata-fields/${fieldId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Topics (Task 7.3) */
/* -------------------------------------------------------------------------- */

const topicSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  name: z.string(),
});

export async function listTopics(
  client: HttpClient,
  departmentId: string,
) {
  return client.request(
    `/v1/departments/${departmentId}/topics`,
    { schema: z.array(topicSchema) },
  );
}

export async function createTopic(
  client: HttpClient,
  departmentId: string,
  name: string,
) {
  return client.request(
    `/v1/departments/${departmentId}/topics`,
    {
      method: 'POST',
      body: { name },
      schema: topicSchema,
    },
  );
}

export async function updateTopic(
  client: HttpClient,
  departmentId: string,
  topicId: string,
  name: string,
) {
  return client.request(
    `/v1/departments/${departmentId}/topics/${topicId}`,
    {
      method: 'PUT',
      body: { name },
      schema: topicSchema,
    },
  );
}

export async function deleteTopic(
  client: HttpClient,
  departmentId: string,
  topicId: string,
) {
  return client.request(
    `/v1/departments/${departmentId}/topics/${topicId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Access State & Grants (Task 7.4) */
/* -------------------------------------------------------------------------- */

export async function setDocumentTypeAccessState(
  client: HttpClient,
  documentTypeId: string,
  accessState: 'OPEN' | 'LOCKED',
) {
  return client.request(
    `/v1/document-types/${documentTypeId}/access-state`,
    {
      method: 'PUT',
      body: { accessState },
      schema: z.object({ accessState: z.enum(['OPEN', 'LOCKED']) }),
    },
  );
}

export async function listAccessRequests(
  client: HttpClient,
  departmentId: string,
) {
  const accessRequestSchema = z.object({
    id: z.string(),
    userId: z.string(),
    documentTypeId: z.string(),
    status: z.enum(['pending', 'approved', 'denied']),
    createdAt: z.string(),
  });

  return client.request(
    `/v1/departments/${departmentId}/access-requests`,
    { schema: z.array(accessRequestSchema) },
  );
}

export async function approveAccessRequest(
  client: HttpClient,
  departmentId: string,
  requestId: string,
) {
  return client.request(
    `/v1/departments/${departmentId}/access-requests/${requestId}/approve`,
    { method: 'POST', schema: z.object({ grantId: z.string() }) },
  );
}

export async function denyAccessRequest(
  client: HttpClient,
  departmentId: string,
  requestId: string,
) {
  return client.request(
    `/v1/departments/${departmentId}/access-requests/${requestId}/deny`,
    { method: 'POST' },
  );
}
