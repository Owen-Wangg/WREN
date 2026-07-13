/**
 * Feedback Integration - Task 4
 *
 * Orchestrates async feedback flow:
 * 1. Request feedback generation (enqueues SQS job)
 * 2. Poll job status until complete
 * 3. Fetch feedback once ready
 * 4. Display progress summary + inline feedback
 */
import { useEffect, useRef } from 'react';
import { useRequestFeedback, usePollFeedbackStatus, useGetFeedback } from './useFeedback';
import type { FeedbackItem } from '@wren/types';

export interface FeedbackIntegrationState {
  isRequesting: boolean;
  isPolling: boolean;
  isLoadingFeedback: boolean;
  feedback: FeedbackItem[] | null;
  progressSummary: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Hook orchestrating full feedback flow:
 * - Request generation → Poll status → Fetch items → Return state
 *
 * Task 4.1: async flow (SQS + polling)
 * Task 4.4: pattern acknowledgment summary
 */
export function useFeedbackIntegration(documentId: string): FeedbackIntegrationState {
  const requestFeedbackMutation = useRequestFeedback();
  const feedbackStatusQuery = usePollFeedbackStatus(documentId);
  const feedbackQuery = useGetFeedback(documentId);

  const hasRequestedRef = useRef(false);

  // When feedback generation completes, refetch feedback
  useEffect(() => {
    if (feedbackStatusQuery.data?.status === 'completed' && !feedbackQuery.data) {
      feedbackQuery.refetch();
    }
  }, [feedbackStatusQuery.data?.status, feedbackQuery]);

  // Determine if we're polling
  const isPolling =
    feedbackStatusQuery.data?.status === 'queued' ||
    feedbackStatusQuery.data?.status === 'processing';

  return {
    isRequesting: requestFeedbackMutation.isPending,
    isPolling,
    isLoadingFeedback: feedbackQuery.isLoading,
    feedback: feedbackQuery.data?.items ?? null,
    progressSummary: feedbackQuery.data?.progressSummary ?? null,
    error: requestFeedbackMutation.error || feedbackStatusQuery.error || feedbackQuery.error
      ? String(requestFeedbackMutation.error || feedbackStatusQuery.error || feedbackQuery.error)
      : null,
  };
}

/**
 * Request feedback generation for a document.
 * Caller should monitor useFeedbackIntegration() for polling state.
 */
export async function requestFeedbackGeneration(
  mutation: ReturnType<typeof useRequestFeedback>,
  documentId: string,
): Promise<void> {
  return mutation.mutateAsync(documentId);
}
