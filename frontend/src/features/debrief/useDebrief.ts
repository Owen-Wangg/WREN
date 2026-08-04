/**
 * React Query hooks for the AI Debrief (task 18.3; Requirements 16.1, 16.2,
 * 48.2, 48.3).
 *
 * Cache invalidation on regeneration is handled by useDebriefSubscription,
 * which fires when the AppSync onDebriefReady event arrives (frontend
 * steering §6: "debrief data must be invalidated/refetched on Regenerate").
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import {
  fetchDebrief,
  fetchDebriefHistory,
  fetchSectionApplicability,
  recordFeedbackHelpfulness,
  recordSectionApplicability,
  regenerateDebrief,
} from './debriefApi';

import type { DebriefHistoryVersion } from './debriefApi';
import type {
  FeedbackHelpfulnessInput,
  HelpfulnessAck,
  SectionApplicabilityInput,
  SectionApplicabilityVotes,
} from './debriefTypes';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { Debrief } from './debriefTypes';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient } from '@/services';

/**
 * Fetches an AI Debrief. When `draftId` is set, loads that historical
 * generation; otherwise loads the latest draft's feedback.
 */
export function useAiDebrief(
  environmentId: string,
  draftId?: string | null,
  enabled = true,
): UseQueryResult<Debrief> {
  return useQuery({
    queryKey: queryKeys.debrief(environmentId, draftId ?? undefined),
    queryFn: () => fetchDebrief(apiClient, environmentId, draftId ?? undefined),
    enabled: !!environmentId && enabled,
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
 * "Regenerate AI Debrief" — enqueues a new Feedback Engine job and returns
 * immediately. Completion is signaled via the AppSync subscription in
 * useDebriefSubscription, which handles cache invalidation once the event
 * fires (Requirement 16.2). The polling fallback in DocumentEditorPage covers
 * the transition period when AppSync is unavailable.
 */
export function useRegenerateDebrief(
  environmentId: string,
): UseMutationResult<void, unknown, void> {
  return useMutation({
    mutationFn: () => regenerateDebrief(apiClient, environmentId),
  });
}

/** Fetches all per-section applicability votes for a debrief. */
export function useSectionApplicability(
  environmentId: string,
  draftId: string | null | undefined,
): UseQueryResult<SectionApplicabilityVotes> {
  return useQuery({
    queryKey: queryKeys.sectionApplicability(environmentId, draftId ?? ''),
    queryFn: () => fetchSectionApplicability(apiClient, environmentId, draftId!),
    enabled: !!environmentId && !!draftId,
  });
}

/** Records (upserts) an applicable/not-applicable vote for one debrief section. */
export function useRecordSectionApplicability(): UseMutationResult<
  HelpfulnessAck,
  unknown,
  SectionApplicabilityInput
> {
  return useMutation({
    mutationFn: (input: SectionApplicabilityInput) =>
      recordSectionApplicability(apiClient, input),
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
