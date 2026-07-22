/**
 * React Query hooks for the AI Debrief (task 18.3; Requirements 16.1, 16.2,
 * 48.2, 48.3).
 *
 * `useRegenerateDebrief` invalidates `queryKeys.debrief(environmentId)` on
 * success — this is the one place regeneration triggers a refetch (frontend
 * steering §6: "debrief data must be invalidated/refetched on 'Regenerate AI
 * Debrief,' not just on mount"). The mutation's own returned payload is also
 * written into the cache via `setQueryData` so the modal updates immediately
 * without waiting on the network round-trip the invalidation triggers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchDebrief,
  fetchDebriefHistory,
  recordFeedbackHelpfulness,
  regenerateDebrief,
} from './debriefApi';

import type { DebriefHistoryVersion } from './debriefApi';
import type { Debrief, FeedbackHelpfulnessInput, HelpfulnessAck } from './debriefTypes';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient } from '@/services';

/**
 * Fetches an AI Debrief. When `draftId` is set, loads that historical
 * generation; otherwise loads the latest draft's feedback.
 */
export function useAiDebrief(
  environmentId: string,
  draftId?: string | null,
): UseQueryResult<Debrief> {
  return useQuery({
    queryKey: queryKeys.debrief(environmentId, draftId ?? undefined),
    queryFn: () => fetchDebrief(apiClient, environmentId, draftId ?? undefined),
    enabled: !!environmentId,
  });
}

/** Lists past AI Debrief generations for a document (newest first). */
export function useDebriefHistory(
  environmentId: string,
): UseQueryResult<DebriefHistoryVersion[]> {
  return useQuery({
    queryKey: queryKeys.debriefHistory(environmentId),
    queryFn: () => fetchDebriefHistory(apiClient, environmentId),
    enabled: !!environmentId,
  });
}

/**
 * "Regenerate AI Debrief" — re-runs the Feedback_Engine and invalidates the
 * environment's debrief cache entry so every consumer of `useAiDebrief` for
 * this environment refetches (Requirement 16.2).
 */
export function useRegenerateDebrief(
  environmentId: string,
): UseMutationResult<Debrief, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => regenerateDebrief(apiClient, environmentId),
    onSuccess: (debrief) => {
      queryClient.setQueryData(queryKeys.debrief(environmentId), debrief);
      if (debrief.draftId && debrief.draftId !== 'none') {
        queryClient.setQueryData(
          queryKeys.debrief(environmentId, debrief.draftId),
          debrief,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.debrief(environmentId).slice(0, 4)],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.debriefHistory(environmentId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.inlineFeedbackItems(environmentId),
      });
    },
  });
}

/**
 * Records a Yes/No (+ optional comment) helpfulness rating for the AI Debrief.
 * POSTs to POST /v1/feedback-helpfulness — persisted anonymously in
 * feedback_helpfulness_rating and surfaced to DepartmentAdmins via
 * GET /v1/analytics/feedback-helpfulness.
 */
export function useFeedbackHelpfulness(): UseMutationResult<
  HelpfulnessAck,
  unknown,
  FeedbackHelpfulnessInput
> {
  return useMutation({
    mutationFn: (input: FeedbackHelpfulnessInput) =>
      recordFeedbackHelpfulness(apiClient, input),
  });
}
