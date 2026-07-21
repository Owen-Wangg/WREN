/**
 * Department Admin API — unified `/v1/*` routes via shared HttpClient.
 *
 * All calls route through `apiClient` with Cognito auth + Zod validation at boundary.
 * Responses validated against `@wren/types` schemas (frontend steering §7).
 */
import { z } from 'zod';
import {
  departmentSchema,
  documentTypeSchema,
  accessGrantSchema,
  userSummarySchema,
} from '@wren/types';
import { apiClient } from '@/services';

export type Department = z.infer<typeof departmentSchema>;
export type DocumentType = z.infer<typeof documentTypeSchema>;

/* -------------------------------------------------------------------------- */
/* Departments — scoped to current user's administered departments */
/* -------------------------------------------------------------------------- */

export async function listDepartments() {
  return apiClient.request('/v1/departments', { schema: z.array(departmentSchema) });
}

export async function getDepartment(departmentId: string) {
  return apiClient.request(`/v1/departments/${departmentId}`, { schema: departmentSchema });
}

/* -------------------------------------------------------------------------- */
/* Document Types — scoped to department */
/* -------------------------------------------------------------------------- */

export async function listDocumentTypes(departmentId?: string) {
  const path = departmentId
    ? `/v1/document-types?departmentId=${departmentId}`
    : '/v1/document-types';
  return apiClient.request(path, { schema: z.array(documentTypeSchema) });
}

export async function createDocumentType(departmentId: string, input: { name: string }) {
  return apiClient.request('/v1/document-types', {
    method: 'POST',
    body: { departmentId, name: input.name },
    schema: documentTypeSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Error Categories — scoped to document type */
/* -------------------------------------------------------------------------- */

const errorCategorySchema = z.object({
  id: z.string(),
  documentTypeId: z.string(),
  name: z.string(),
});

export type ErrorCategory = z.infer<typeof errorCategorySchema>;

export async function listErrorCategories(documentTypeId: string) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/error-categories`, {
    schema: z.array(errorCategorySchema),
  });
}

export async function createErrorCategory(documentTypeId: string, name: string) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/error-categories`, {
    method: 'POST',
    body: { name },
    schema: errorCategorySchema,
  });
}

export async function deleteDocumentType(documentTypeId: string) {
  return apiClient.request(`/v1/document-types/${documentTypeId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Document Type Configuration */
/* -------------------------------------------------------------------------- */

const documentTypeConfigSchema = z.object({
  documentTypeId: z.string(),
  tone: z.string().nullable().optional(),
  density: z.string().nullable().optional(),
  categoryPriority: z.array(z.string()).optional(),
  typePromptText: z.string().nullable().optional(),
  toneDescription: z.string().nullable().optional(),
  densityDescription: z.string().nullable().optional(),
  structureDescription: z.string().nullable().optional(),
  restrictionsDescription: z.string().nullable().optional(),
  notesDescription: z.string().nullable().optional(),
});

export type DocumentTypeConfig = z.infer<typeof documentTypeConfigSchema>;

export async function getDocumentTypeConfig(documentTypeId: string) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/config`, {
    schema: documentTypeConfigSchema,
  });
}

export async function updateDocumentTypeConfig(
  documentTypeId: string,
  updates: {
    tone?: string | null;
    density?: string | null;
    typePromptText?: string | null;
    toneDescription?: string | null;
    densityDescription?: string | null;
    structureDescription?: string | null;
    restrictionsDescription?: string | null;
    notesDescription?: string | null;
    categoryPriority?: string[];
  },
) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/config`, {
    method: 'PUT',
    body: updates,
    schema: documentTypeConfigSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Users — department-scoped search (DepartmentAdmin scoped) */
/* -------------------------------------------------------------------------- */

const usersSearchSchema = z.object({
  items: z.array(userSummarySchema),
  total: z.number().int().nonnegative(),
});

export async function searchUsers(options?: {
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
  return apiClient.request(path, { schema: usersSearchSchema });
}

/* -------------------------------------------------------------------------- */
/* Content Types — scoped to document type */
/* -------------------------------------------------------------------------- */

const contentTypeSchema = z.object({
  id: z.string(),
  documentTypeId: z.string(),
  label: z.string(),
});

export async function listContentTypes(documentTypeId: string) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/content-types`, {
    schema: z.array(contentTypeSchema),
  });
}

export async function createContentType(documentTypeId: string, input: { label: string }) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/content-types`, {
    method: 'POST',
    body: input,
    schema: contentTypeSchema,
  });
}

export async function deleteContentType(documentTypeId: string, contentTypeId: string) {
  return apiClient.request(
    `/v1/document-types/${documentTypeId}/content-types/${contentTypeId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Metadata Fields — scoped to document type */
/* -------------------------------------------------------------------------- */

const metadataFieldSchema = z.object({
  id: z.string(),
  documentTypeId: z.string(),
  label: z.string(),
  required: z.boolean(),
});

export async function listMetadataFields(documentTypeId: string) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/metadata-fields`, {
    schema: z.array(metadataFieldSchema),
  });
}

export async function createMetadataField(
  documentTypeId: string,
  input: { label: string; required?: boolean },
) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/metadata-fields`, {
    method: 'POST',
    body: input,
    schema: metadataFieldSchema,
  });
}

export async function deleteMetadataField(documentTypeId: string, fieldId: string) {
  return apiClient.request(
    `/v1/document-types/${documentTypeId}/metadata-fields/${fieldId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Topics — scoped to department */
/* -------------------------------------------------------------------------- */

const topicSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  name: z.string(),
});

export async function listTopics(departmentId: string) {
  return apiClient.request(`/v1/departments/${departmentId}/topics`, {
    schema: z.array(topicSchema),
  });
}

export async function createTopic(departmentId: string, name: string) {
  return apiClient.request(`/v1/departments/${departmentId}/topics`, {
    method: 'POST',
    body: { name },
    schema: topicSchema,
  });
}

export async function updateTopic(departmentId: string, topicId: string, name: string) {
  return apiClient.request(`/v1/departments/${departmentId}/topics/${topicId}`, {
    method: 'PUT',
    body: { name },
    schema: topicSchema,
  });
}

export async function deleteTopic(departmentId: string, topicId: string) {
  return apiClient.request(`/v1/departments/${departmentId}/topics/${topicId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Access Control — document type access grants */
/* -------------------------------------------------------------------------- */

export async function setDocumentTypeAccessState(
  documentTypeId: string,
  accessState: 'OPEN' | 'LOCKED',
) {
  return apiClient.request(`/v1/document-types/${documentTypeId}/access-state`, {
    method: 'PUT',
    body: { accessState },
    schema: z.object({ accessState: z.enum(['OPEN', 'LOCKED']) }),
  });
}

export async function grantAccessToUser(userId: string, documentTypeId: string) {
  return apiClient.request('/v1/access-grants', {
    method: 'POST',
    body: { userId, documentTypeId },
    schema: accessGrantSchema,
  });
}

export async function revokeAccessGrant(grantId: string) {
  return apiClient.request(`/v1/access-grants/${grantId}`, { method: 'DELETE' });
}

/* -------------------------------------------------------------------------- */
/* Analytics — department-scoped aggregates */
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

export async function getAnalytics(documentTypeId?: string) {
  const path = documentTypeId
    ? `/v1/analytics?documentTypeId=${documentTypeId}`
    : '/v1/analytics';
  return apiClient.request(path, { schema: analyticsSchema });
}
