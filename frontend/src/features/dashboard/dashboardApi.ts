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
  writingTypeSchema,
} from '@wren/types';

import {
  accessRequestAckSchema,
  accessRequestInputSchema,
  contentTypeSchema,
  organizationAccessSchema,
  type AccessRequestAck,
  type AccessRequestInput,
  type ContentType,
  type OrganizationAccess,
} from './dashboardTypes';

import type { AccessGrant, Document, WritingType } from '@wren/types';
import type { HttpClient } from '@/services';

export const DOCUMENTS_PATH = '/documents';
export const WRITING_TYPES_PATH = '/writing-types';
export const ORGANIZATIONS_PATH = '/organizations';
export const ACCESS_GRANTS_PATH = '/access-grants';
export const ACCESS_REQUESTS_PATH = '/access-requests';
export const CONTENT_TYPES_PATH = '/content-types';

const documentsSchema = z.array(documentSchema);
const writingTypesSchema = z.array(writingTypeSchema);
const organizationsSchema = z.array(organizationAccessSchema);
const accessGrantsSchema = z.array(accessGrantSchema);
const contentTypesSchema = z.array(contentTypeSchema);

/** The current user's Documents for the "My Documents" dashboard (Requirement 4.2). */
export function fetchDocuments(client: HttpClient): Promise<Document[]> {
  return client.request(DOCUMENTS_PATH, { schema: documentsSchema });
}

/** The Writing Type catalog the writer may self-select from (Requirements 4.2, 28.2). */
export function fetchWritingTypes(client: HttpClient): Promise<WritingType[]> {
  return client.request(WRITING_TYPES_PATH, { schema: writingTypesSchema });
}

/** Organization access states, used to resolve `INHERIT` Writing Types (Requirement 4.1). */
export function fetchOrganizations(
  client: HttpClient,
): Promise<OrganizationAccess[]> {
  return client.request(ORGANIZATIONS_PATH, { schema: organizationsSchema });
}

/** The current user's Access Grants, used to resolve LOCKED submission permission (Requirement 6.8). */
export function fetchAccessGrants(client: HttpClient): Promise<AccessGrant[]> {
  return client.request(ACCESS_GRANTS_PATH, { schema: accessGrantsSchema });
}

/** Content Types available for the given Organization (scoped dropdown options). */
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
