/**
 * Document & Draft API calls — thin functions over the shared {@link HttpClient}
 * (frontend steering §11: never bypass the shared API client wrapper).
 *
 * All responses validated with Zod schemas from @wren/types (frontend steering §7).
 * Handles error cases: 401 (Unauthorized), 403 (Forbidden), 400 (Validation).
 */
import { z } from 'zod';
import {
  documentSchema,
  draftSchema,
  createDocumentInputSchema,
  type Document,
  type Draft,
  type CreateDocumentInput,
} from '@wren/types';
import type { HttpClient } from '@/services/apiClient';

// Re-export the shared domain types consumed alongside these API helpers so
// hooks can import both the functions and their types from one module.
export type { Document, Draft, CreateDocumentInput } from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Path Constants */
/* -------------------------------------------------------------------------- */

const DOCUMENTS_PATH = '/v1/documents';
const UPLOADS_PATH = '/v1/uploads/presign';

/* -------------------------------------------------------------------------- */
/* Reusable Response Schemas */
/* -------------------------------------------------------------------------- */

const documentsListSchema = z.object({
  items: z.array(documentSchema),
  total: z.number().int().nonnegative(),
});

/* -------------------------------------------------------------------------- */
/* Document Operations */
/* -------------------------------------------------------------------------- */

/**
 * List the authenticated user's documents with optional filtering.
 */
export async function listDocuments(
  client: HttpClient,
  options?: {
    status?: 'Still Drafting' | 'Polishing';
    limit?: number;
    offset?: number;
  },
): Promise<{ items: Document[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.status) params.append('status', options.status);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const path = queryString ? `${DOCUMENTS_PATH}?${queryString}` : DOCUMENTS_PATH;

  return client.request(path, { schema: documentsListSchema });
}

/**
 * Create a new document (from file upload or pasted text).
 */
export async function createDocument(
  client: HttpClient,
  input: CreateDocumentInput,
): Promise<Document> {
  const body = createDocumentInputSchema.parse(input);
  return client.request(DOCUMENTS_PATH, {
    method: 'POST',
    body,
    schema: documentSchema,
  });
}

/**
 * Get a document with its drafts and metadata.
 */
export async function getDocument(
  client: HttpClient,
  documentId: string,
): Promise<Document> {
  return client.request(`${DOCUMENTS_PATH}/${documentId}`, {
    schema: documentSchema,
  });
}

/**
 * Delete a document (cascades to drafts/feedback; retains activity log).
 */
export async function deleteDocument(
  client: HttpClient,
  documentId: string,
): Promise<{
  documentId: string;
  deletedDrafts: number;
  deletedFeedbackItems: number;
}> {
  const responseSchema = z.object({
    documentId: z.string(),
    deletedDrafts: z.number().int().nonnegative(),
    deletedFeedbackItems: z.number().int().nonnegative(),
  });

  return client.request(`${DOCUMENTS_PATH}/${documentId}`, {
    method: 'DELETE',
    body: { confirmed: true },
    schema: responseSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Draft Operations */
/* -------------------------------------------------------------------------- */

/**
 * Submit a new draft for a document (resubmission).
 */
export async function submitDraft(
  client: HttpClient,
  documentId: string,
  source: {
    kind: 'file' | 'paste';
    text?: string;
    key?: string;
  },
): Promise<Draft> {
  const body = { source };
  return client.request(`${DOCUMENTS_PATH}/${documentId}/drafts`, {
    method: 'POST',
    body,
    schema: draftSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Presigned Upload URL */
/* -------------------------------------------------------------------------- */

/**
 * Get a presigned S3 URL for document upload.
 */
export async function getPresignedUrl(
  client: HttpClient,
  filename: string,
  contentType: string,
): Promise<{
  uploadUrl: string;
  fields: Record<string, string>;
  key: string;
}> {
  const responseSchema = z.object({
    uploadUrl: z.string().url(),
    fields: z.record(z.string()),
    key: z.string().min(1),
  });

  const body = { filename, contentType };
  return client.request(UPLOADS_PATH, {
    method: 'POST',
    body,
    schema: responseSchema,
  });
}
