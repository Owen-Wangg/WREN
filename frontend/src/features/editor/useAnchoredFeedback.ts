/**
 * React Query hooks for the editor's inline anchored-feedback data (task
 * 18.2). Mirrors `features/debrief/useDebrief.ts`'s pattern: plain hooks over
 * the shared `apiClient`, keyed by `queryKeys` so cache scoping stays
 * per-writing-environment (frontend steering §6).
 */
import { useQuery } from '@tanstack/react-query';

import { fetchDocumentFeedback } from './anchoredFeedbackApi';

import type { Anchor, FeedbackItem } from '@wren/types';
import type { UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient } from '@/services';

type DocumentFeedback = {
  items: FeedbackItem[];
  anchors: Anchor[];
};

/** Shared feedback payload (items + anchors) for a document. */
export function useDocumentFeedback(documentId: string): UseQueryResult<DocumentFeedback> {
  return useQuery({
    queryKey: queryKeys.inlineFeedbackItems(documentId),
    queryFn: () => fetchDocumentFeedback(apiClient, documentId),
  });
}

/** Fetches all Feedback Items for a writing environment's current draft. */
export function useFeedbackItems(environmentId: string): UseQueryResult<FeedbackItem[]> {
  return useQuery({
    queryKey: queryKeys.inlineFeedbackItems(environmentId),
    queryFn: () => fetchDocumentFeedback(apiClient, environmentId),
    select: (data) => data.items,
  });
}

/** Fetches Anchors for a writing environment's current draft. */
export function useAnchors(environmentId: string): UseQueryResult<Anchor[]> {
  return useQuery({
    queryKey: queryKeys.inlineFeedbackItems(environmentId),
    queryFn: () => fetchDocumentFeedback(apiClient, environmentId),
    select: (data) => data.anchors,
  });
}
