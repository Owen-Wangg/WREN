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
    /** OCR engine for PDF ingest. */
    ocrEngine?: OcrEngineChoice;
  },
): Promise<Document> {
  return client.request(DOCUMENTS_PATH, {
    method: 'POST',
    body: input,
    schema: documentSchema,
  });
}

/** Presigned S3 POST for uploading a document file before create. */
export type PresignUploadResponse = {
  uploadUrl: string;
  fields: Record<string, string>;
  key: string;
};

const presignUploadSchema = z.object({
  uploadUrl: z.string().url(),
  fields: z.record(z.string()),
  key: z.string().min(1),
});

export function getPresignedUrl(
  client: HttpClient,
  filename: string,
  contentType: string,
): Promise<PresignUploadResponse> {
  return client.request('/v1/uploads/presign', {
    method: 'POST',
    body: { filename, contentType },
    schema: presignUploadSchema,
  });
}

/** POST the file to S3 using the presigned POST fields (not a raw PUT). */
export async function uploadFileToPresign(
  presign: PresignUploadResponse,
  file: File,
): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(presign.fields)) {
    form.append(name, value);
  }
  form.append('file', file);
  const putResponse = await fetch(presign.uploadUrl, { method: 'POST', body: form });
  if (!putResponse.ok) {
    throw new Error('File upload to storage failed');
  }
}

export type { Draft };

/** Fetches the latest draft for a document. */
export function fetchLatestDraft(client: HttpClient, documentId: string): Promise<Draft> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    schema: draftSchema,
  });
}

const ocrEngineResultSchema = z.object({
  text: z.string(),
  durationMs: z.number(),
  textLength: z.number(),
});

const ocrComparisonSchema = z.object({
  textract: ocrEngineResultSchema.optional(),
  primaryEngine: z.string(),
});

const ingestStatusSchema = z.object({
  status: z.enum(['pending', 'queued', 'processing', 'completed', 'failed']),
  jobId: z.string().optional(),
  draftId: z.string().optional(),
  errorMessage: z.string().optional(),
  ocrEngine: z.string().optional(),
  comparison: ocrComparisonSchema.optional(),
});

export type IngestStatus = z.infer<typeof ingestStatusSchema>;
export type OcrComparison = z.infer<typeof ocrComparisonSchema>;
export type OcrEngineChoice = 'textract';

/** Polls async PDF ingest status (`queued` → `completed` / `failed`). */
export function fetchIngestStatus(
  client: HttpClient,
  documentId: string,
): Promise<IngestStatus> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/ingest/status`, {
    schema: ingestStatusSchema,
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

/**
 * Autosave TipTap content (+ optional header/footer) onto the current draft
 * without creating a new version.
 * With `keepalive: true` (unload flush), the response body is not validated and
 * the return value may be undefined.
 */
export function patchCurrentDraft(
  client: HttpClient,
  documentId: string,
  content: TipTapDoc,
  options?: {
    readonly keepalive?: boolean;
    readonly header?: TipTapDoc | null;
    readonly footer?: TipTapDoc | null;
  },
): Promise<Draft | undefined> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts/current`, {
    method: 'PATCH',
    body: {
      content,
      ...(options?.header != null ? { header: options.header } : {}),
      ...(options?.footer != null ? { footer: options.footer } : {}),
    },
    ...(options?.keepalive
      ? { keepalive: true }
      : { schema: draftSchema }),
  });
}

const draftFromSourceResponseSchema = z.union([
  draftSchema,
  z.object({
    ingestStatus: z.literal('queued'),
    jobId: z.string().min(1),
    documentId: z.string().min(1),
  }),
]);

export type DraftFromSourceResult =
  | { kind: 'draft'; draft: Draft }
  | { kind: 'ingestQueued'; jobId: string; documentId: string };

/** Creates a new draft by server-ingesting an uploaded file (or paste). */
export async function createDraftFromSource(
  client: HttpClient,
  documentId: string,
  source: { kind: 'file'; key: string } | { kind: 'paste'; text: string },
  content?: TipTapDoc,
  ocrEngine?: OcrEngineChoice,
): Promise<DraftFromSourceResult> {
  const result = await client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    method: 'POST',
    body: {
      source,
      ...(content ? { content } : {}),
      ...(ocrEngine ? { ocrEngine } : {}),
    },
    schema: draftFromSourceResponseSchema,
  });
  if ('ingestStatus' in result && result.ingestStatus === 'queued') {
    return { kind: 'ingestQueued', jobId: result.jobId, documentId: result.documentId };
  }
  return { kind: 'draft', draft: result as Draft };
}
