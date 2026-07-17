/**
 * React Query hooks for feedback management.
 *
 * Handles feedback retrieval and async generation with polling support.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  getFeedback,
  requestFeedback,
  getFeedbackStatus,
  checkCanGenerateFeedback,
} from '@/services/api/feedbackApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Query Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get feedback items for a document's current draft.
 */
export function useGetFeedback(documentId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.feedback(documentId),
    queryFn: () => getFeedback(client, documentId),
    staleTime: 30_000,
    enabled: !!documentId,
  });
}

/**
 * Query hook: poll feedback generation status.
 * Automatically stops polling when status is 'completed' or 'failed'.
 */
export function usePollFeedbackStatus(documentId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: queryKeys.feedbackStatus(documentId),
    queryFn: () => getFeedbackStatus(client, documentId),
    refetchInterval: (data) => {
      if (!data) return 2000;
      const status = (data as any)?.status;
      if (status === 'completed' || status === 'failed') {
        return false;
      }
      return 2000;
    },
    enabled: !!documentId,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutation Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: request feedback generation for a document (async).
 * Returns job ID and initial status.
 */
export function useRequestFeedback() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => requestFeedback(client, documentId),
    onSuccess: (_data, documentId) => {
      queryClient.setQueryData(queryKeys.feedbackStatus(documentId), {
        status: 'queued',
      });
    },
  });
}

/**
 * Query hook: check if feedback generation is allowed for a document.
 * Checks usage limits before allowing request (Task 8.1).
 */
export function useCanGenerateFeedback(documentId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.feedbackStatus(documentId),
    queryFn: () => checkCanGenerateFeedback(client, documentId),
    enabled: !!documentId,
    staleTime: 10_000, // 10 seconds
  });
}
