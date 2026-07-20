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
  id: z.string().min(1),
  name: z.string().min(1),
});

/** Backend DocumentType DTO mapped into the dashboard Writing Type shape. */
const documentTypeDtoSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
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

/** Document Types for a Department — GET /v1/document-types?departmentId=... */
export async function fetchDocumentTypesForDepartment(
  client: HttpClient,
  departmentId: string,
): Promise<WritingType[]> {
  const raw = await client.request(`${WRITING_TYPES_PATH}?departmentId=${departmentId}`, {
    schema: z.array(documentTypeDtoSchema),
  });
  return writingTypesSchema.parse(
    raw.map((t) => ({
      id: t.id,
      organizationId: t.departmentId,
      name: t.name,
      accessState: t.accessState,
      sizeLimitWords: t.sizeLimitWords ?? null,
    })),
  );
}

/**
 * Content Types for a Document Type — GET /v1/document-types/{id}/content-types.
 * Mapped into the dashboard ContentType shape (`label` → `name`).
 */
export async function fetchContentTypes(
  client: HttpClient,
  documentTypeId: string,
  organizationId: string,
): Promise<ContentType[]> {
  const raw = await client.request(`${WRITING_TYPES_PATH}/${documentTypeId}/content-types`, {
    schema: z.array(
      z.object({
        id: z.string().min(1),
        documentTypeId: z.string().min(1),
        label: z.string().min(1),
      }),
    ),
  });
  return contentTypesSchema.parse(
    raw.map((ct) => ({
      id: ct.id,
      organizationId,
      writingTypeId: ct.documentTypeId,
      name: ct.label,
    })),
  );
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

/** Map a Document Lambda row (snake_case or camelCase) into the shared Document DTO. */
function mapDocumentDto(raw: Record<string, unknown>): Document {
  const metadataRaw = raw.metadata ?? raw.Metadata;
  let metadata: Record<string, string> = {};
  if (typeof metadataRaw === 'string') {
    try {
      metadata = JSON.parse(metadataRaw) as Record<string, string>;
    } catch {
      metadata = {};
    }
  } else if (metadataRaw && typeof metadataRaw === 'object') {
    metadata = metadataRaw as Record<string, string>;
  }

  const createdAtRaw = raw.createdAt ?? raw.created_at;
  let createdAt =
    createdAtRaw instanceof Date
      ? createdAtRaw.toISOString()
      : typeof createdAtRaw === 'string'
        ? createdAtRaw
        : new Date().toISOString();
  // isoDateTimeSchema requires an offset; pg sometimes returns bare local timestamps.
  if (
    typeof createdAt === 'string' &&
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(createdAt)
  ) {
    createdAt = `${createdAt}Z`;
  }

  return documentSchema.parse({
    id: raw.id,
    ownerUserId: raw.ownerUserId ?? raw.owner_user_id,
    documentTypeId: raw.documentTypeId ?? raw.document_type_id,
    contentTypeId: raw.contentTypeId ?? raw.content_type_id,
    name: raw.name,
    metadata,
    status: raw.status,
    createdAt,
  });
}

const rawDocumentSchema = z.record(z.string(), z.unknown());

/** Fetches a single Document by ID. */
export async function fetchDocument(client: HttpClient, documentId: string): Promise<Document> {
  const raw = await client.request(`${DOCUMENTS_PATH}/${documentId}`, {
    schema: rawDocumentSchema,
  });
  return mapDocumentDto(raw);
}

/** Creates a new Document record in the backend. Returns the created Document. */
export async function createDocument(
  client: HttpClient,
  input: { documentTypeId: string; contentTypeId: string; name: string },
): Promise<Document> {
  const raw = await client.request(DOCUMENTS_PATH, {
    method: 'POST',
    body: input,
    schema: rawDocumentSchema,
  });
  return mapDocumentDto(raw);
}

const draftSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  versionNumber: z.number().int().positive(),
  segments: z.array(z.unknown()),
  createdAt: z.string(),
});

export type Draft = z.infer<typeof draftSchema>;

/** Submits parsed document segments as a new draft version. */
export function createDraft(
  client: HttpClient,
  documentId: string,
  segments: unknown[],
): Promise<Draft> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    method: 'POST',
    body: { segments },
    schema: draftSchema,
  });
}
