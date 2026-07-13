/**
 * React Query hook for the writer progress summary (task 18.4; Requirements
 * 18.1, 18.3, 18.4).
 *
 * Keyed by `queryKeys.progressSummary(environmentId)` so it participates in the
 * same per-environment cache scoping as the AI Debrief and refetches when the
 * environment's caches are invalidated (e.g. after a new draft is submitted or
 * "Regenerate AI Debrief" runs).
 */
import { useQuery } from '@tanstack/react-query';

import { fetchProgressSummary } from './progressApi';

import type { WriterProgressSummary } from './progressTypes';
import type { UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient } from '@/services';

/** Fetches the current draft's qualitative progress summary for a writing environment. */
export function useWriterProgressSummary(
  environmentId: string,
): UseQueryResult<WriterProgressSummary> {
  return useQuery({
    queryKey: queryKeys.progressSummary(environmentId),
    queryFn: () => fetchProgressSummary(apiClient, environmentId),
  });
}
