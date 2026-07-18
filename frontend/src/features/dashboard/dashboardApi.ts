/**
 * Writer dashboard API calls — thin wrappers over the shared {@link HttpClient}
 * (frontend steering §11: never bypass the shared API client wrapper). Each
 * response is validated against a Zod schema at the boundary, mirroring the
 * `debriefApi.ts` convention (plain functions taking the client).
 */
import { z } from 'zod';

import {
  accessGrantSchema,
  documentSchema,
} from '@wren/types';

import {
  accessRequestAckSchema,
  accessRequestInputSchema,
  contentTypeSchema,
  organizationAccessSchema,
  writingTypeSchema,
  type AccessRequestAck,
  type AccessRequestInput,
  type ContentType,
  type OrganizationAccess,
  type WritingType,
} from './dashboardTypes';

import type { AccessGrant, Document } from '@wren/types';
import type { HttpClient } from '@/services';

export const DOCUMENTS_PATH = '/v1/documents';
export const WRITING_TYPES_PATH = '/v1/document-types';
export const ORGANIZATIONS_PATH = '/v1/departments';
export const ACCESS_GRANTS_PATH = '/v1/access-grants';
export const ACCESS_REQUESTS_PATH = '/v1/access-requests';
export const CONTENT_TYPES_PATH = '/v1/content-types';

const documentsListSchema = z.object({
  items: z.array(documentSchema),
  total: z.number().int().nonnegative(),
});
const writingTypesSchema = z.array(writingTypeSchema);
const organizationsSchema = z.array(organizationAccessSchema);
const accessGrantsSchema = z.array(accessGrantSchema);
const contentTypesSchema = z.array(contentTypeSchema);

/** Backend Department DTO (V4) — no accessState; dashboard treats groupings as OPEN. */
const departmentDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

/** Backend DocumentType DTO mapped into the dashboard Writing Type shape. */
const documentTypeDtoSchema = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid(),
  name: z.string().min(1),
  accessState: z.enum(['OPEN', 'LOCKED']),
  sizeLimitWords: z.number().int().positive().nullable().optional(),
});

/** The current user's Documents for the "My Documents" dashboard (Requirement 4.2). */
export async function fetchDocuments(client: HttpClient): Promise<Document[]> {
  const result = await client.request(DOCUMENTS_PATH, { schema: documentsListSchema });
  return result.items;
}

/** The Writing Type catalog the writer may self-select from (Requirements 4.2, 28.2). */
export async function fetchWritingTypes(client: HttpClient): Promise<WritingType[]> {
  const types = await client.request(WRITING_TYPES_PATH, {
    schema: z.array(documentTypeDtoSchema),
  });
  return writingTypesSchema.parse(
    types.map((t) => ({
      id: t.id,
      organizationId: t.departmentId,
      name: t.name,
      accessState: t.accessState,
      sizeLimitWords: t.sizeLimitWords ?? null,
    })),
  );
}

/** Department groupings (V4). Mapped to the dashboard's organizationAccess shape. */
export async function fetchOrganizations(
  client: HttpClient,
): Promise<OrganizationAccess[]> {
  const departments = await client.request(ORGANIZATIONS_PATH, {
    schema: z.array(departmentDtoSchema),
  });
  return organizationsSchema.parse(
    departments.map((d) => ({
      id: d.id,
      name: d.name,
      accessState: 'OPEN' as const,
    })),
  );
}

/** The current user's Access Grants, used to resolve LOCKED submission permission (Requirement 6.8). */
export function fetchAccessGrants(client: HttpClient): Promise<AccessGrant[]> {
  return client.request(ACCESS_GRANTS_PATH, { schema: accessGrantsSchema });
}

/** Content Types available for the given Department (scoped dropdown options). */
export function fetchContentTypes(client: HttpClient, organizationId: string): Promise<ContentType[]> {
  return client.request(`${ORGANIZATIONS_PATH}/${organizationId}/content-types`, {
    schema: contentTypesSchema,
  });
}

/**
 * Requests access to a LOCKED Writing Type (Requirement 4.6) — the writer is
 * offered this flow instead of being silently blocked. The input is validated
 * before it leaves this module, and the ack validated at the boundary.
 */
export function requestAccess(
  client: HttpClient,
  input: AccessRequestInput,
): Promise<AccessRequestAck> {
  const body = accessRequestInputSchema.parse(input);
  return client.request(ACCESS_REQUESTS_PATH, {
    method: 'POST',
    body,
    schema: accessRequestAckSchema,
  });
}
