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
  draftSchema,
  type TipTapDoc,
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

import type { AccessGrant, Document, Draft } from '@wren/types';
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

/** Fetches a single Document by ID. */
export function fetchDocument(client: HttpClient, documentId: string): Promise<Document> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}`, { schema: documentSchema });
}

/** Creates a Document and ingests the first draft from file (S3 key) or paste. */
export function createDocument(
  client: HttpClient,
  input: {
    documentTypeId: string;
    contentTypeId?: string;
    name: string;
    metadata?: Record<string, string>;
    source: { kind: 'file'; key: string } | { kind: 'paste'; text: string };
    /** Optional TipTap JSON so rich formatting survives reload. */
    content?: TipTapDoc;
  },
): Promise<Document> {
  return client.request(DOCUMENTS_PATH, {
    method: 'POST',
    body: input,
    schema: documentSchema,
  });
}

/** Presigned S3 PUT URL for uploading a document file before create. */
export function getPresignedUrl(
  client: HttpClient,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; key: string }> {
  return client.request('/v1/uploads/presign', {
    method: 'POST',
    body: { filename, contentType },
    schema: z.object({
      uploadUrl: z.string().url(),
      key: z.string().min(1),
    }),
  });
}

export type { Draft };

/** Fetches the latest draft for a document. */
export function fetchLatestDraft(client: HttpClient, documentId: string): Promise<Draft> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    schema: draftSchema,
  });
}

/** Submits TipTap content (preferred) and/or segments as a new draft version. */
export function createDraft(
  client: HttpClient,
  documentId: string,
  segments: Array<{ index: number; text: string }>,
  content?: TipTapDoc,
): Promise<Draft> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    method: 'POST',
    body: { segments, ...(content ? { content } : {}) },
    schema: draftSchema,
  });
}

/** Creates a new draft by server-ingesting an uploaded file (or paste). */
export function createDraftFromSource(
  client: HttpClient,
  documentId: string,
  source: { kind: 'file'; key: string } | { kind: 'paste'; text: string },
  content?: TipTapDoc,
): Promise<Draft> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    method: 'POST',
    body: { source, ...(content ? { content } : {}) },
    schema: draftSchema,
  });
}
