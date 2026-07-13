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

import { fetchDebrief, recordFeedbackHelpfulness, regenerateDebrief } from './debriefApi';

import type { Debrief, FeedbackHelpfulnessInput, HelpfulnessAck } from './debriefTypes';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient } from '@/services';

/** Fetches the current AI Debrief for a writing environment; refetches on mount if stale. */
export function useAiDebrief(environmentId: string): UseQueryResult<Debrief> {
  return useQuery({
    queryKey: queryKeys.debrief(environmentId),
    queryFn: () => fetchDebrief(apiClient, environmentId),
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.debrief(environmentId),
      });
    },
  });
}

/**
 * Records a Yes/No (+ optional comment) helpfulness rating. This is the audit
 * event call site described by the design/steering — the real Audit_Service
 * (task 14) doesn't exist yet, so `recordFeedbackHelpfulness` is a stubbed mock
 * API method with the eventual event shape already in place.
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
