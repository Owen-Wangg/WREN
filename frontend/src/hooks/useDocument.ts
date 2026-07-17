/**
 * React Query hooks for document management.
 *
 * Handles listing, creating, retrieving, and deleting documents.
 * Integrates with HTTP client for API calls and Zod validation.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  listDocuments,
  createDocument,
  getDocument,
  deleteDocument,
  submitDraft,
  getPresignedUrl,
  type CreateDocumentInput,
} from '@/services/api/documentApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Query Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: list the authenticated user's documents.
 */
export function useListDocuments(options?: {
  status?: 'Still Drafting' | 'Polishing';
  limit?: number;
  offset?: number;
}) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.documents(),
    queryFn: () => listDocuments(client, options),
    staleTime: 30_000,
  });
}

/**
 * Query hook: get a single document.
 */
export function useGetDocument(documentId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => getDocument(client, documentId),
    staleTime: 30_000,
    enabled: !!documentId,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutation Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: create a new document.
 */
export function useCreateDocument() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateDocumentInput) => createDocument(client, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents() });
      queryClient.setQueryData(queryKeys.document(data.id), data);
    },
  });
}

/**
 * Mutation hook: delete a document.
 */
export function useDeleteDocument() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => deleteDocument(client, documentId),
    onSuccess: (_data, documentId) => {
      queryClient.removeQueries({ queryKey: queryKeys.document(documentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.documents() });
    },
  });
}

/**
 * Mutation hook: submit a new draft for a document.
 */
export function useSubmitDraft() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      source,
    }: {
      documentId: string;
      source: {
        kind: 'file' | 'paste';
        text?: string;
        key?: string;
      };
    }) => submitDraft(client, documentId, source),
    onSuccess: (_data, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.drafts(documentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.feedback(documentId) });
      queryClient.setQueryData(queryKeys.feedbackStatus(documentId), {
        status: 'queued',
      });
    },
  });
}

/**
 * Mutation hook: get a presigned upload URL for document file.
 */
export function useGetPresignedUrl() {
  const client = useApiClient();

  return useMutation({
    mutationFn: ({
      filename,
      contentType,
    }: {
      filename: string;
      contentType: string;
    }) => getPresignedUrl(client, filename, contentType),
  });
}
