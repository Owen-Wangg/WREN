/**
 * useDebriefSubscription — AppSync real-time subscription for debrief-ready
 * notifications.
 *
 * Subscribes to `onDebriefReady` and on receipt fetches the full debrief via
 * REST then updates the React Query cache.
 *
 * The `onComplete` callback is called after the cache is updated so the caller
 * can clear its "is generating" state. `itemCount` is 0 when generation failed
 * without persisting items (truncated output, missing segments).
 *
 * When VITE_APPSYNC_URL is absent or the subscription fails, this is a no-op
 * — the polling fallback in DocumentEditorPage handles completion.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { subscribeToAppSync } from '@/services/appSyncClient';
import { sanitizeForLog } from '@/lib/logSanitize';
import { fetchDebrief } from './debriefApi';
import { queryKeys } from '@/hooks/queryKeys';
import { apiClient } from '@/services';

const ON_DEBRIEF_READY_SUBSCRIPTION = /* GraphQL */ `
  subscription OnDebriefReady($documentId: ID!) {
    onDebriefReady(documentId: $documentId) {
      documentId
      draftId
      itemCount
    }
  }
`;

const debriefReadyPayloadSchema = z.object({
  data: z.object({
    onDebriefReady: z.object({
      documentId: z.string(),
      draftId: z.string(),
      itemCount: z.number().int().nonnegative(),
    }),
  }),
});

/**
 * @param expectedDraftId Draft the caller queued a job for (from the 202
 *   response). When set, events for any other draft are ignored, so a stray or
 *   spoofed debriefReady cannot end the wait state. `null` disables the filter
 *   (older backend that does not return draftId).
 */
export function useDebriefSubscription(
  documentId: string,
  enabled: boolean,
  onComplete: (itemCount: number) => void,
  expectedDraftId: string | null = null,
): void {
  const queryClient = useQueryClient();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!enabled || !documentId) return;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void subscribeToAppSync(
      ON_DEBRIEF_READY_SUBSCRIPTION,
      { documentId },
      {
        next: (payload: unknown) => {
          const parsed = debriefReadyPayloadSchema.safeParse(payload);
          if (!parsed.success) return;

          const { documentId: eventDocumentId, draftId, itemCount } =
            parsed.data.data.onDebriefReady;

          // Only act on events for the job this hook is waiting on.
          if (eventDocumentId !== documentId) return;
          if (expectedDraftId !== null && draftId !== expectedDraftId) return;

          if (itemCount === 0) {
            onCompleteRef.current(0);
            return;
          }

          // Fetch by the specific draftId from the AppSync event — not "latest".
          // The autosave may have created a newer empty draft by the time this
          // fires; fetching latest would return that empty draft instead.
          void fetchDebrief(apiClient, documentId, draftId).then((debrief) => {
            // Populate both the 'latest' slot and the draftId-specific slot so
            // the panel renders immediately and history view works. Do NOT
            // invalidate the debrief prefix here — that would trigger a
            // background refetch of 'latest' which may return a newer autosaved
            // draft with 0 items, overwriting the data we just set.
            queryClient.setQueryData(queryKeys.debrief(documentId), debrief);
            queryClient.setQueryData(queryKeys.debrief(documentId, draftId), debrief);
            // Invalidate supporting queries that need to reflect the new feedback.
            void queryClient.invalidateQueries({
              queryKey: queryKeys.debriefHistory(documentId),
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.inlineFeedbackItems(documentId),
            });
            onCompleteRef.current(itemCount);
          });
        },
        error: (err: unknown) => {
          // err originates from the untrusted AppSync subscription channel —
          // sanitize before logging to prevent log forgery/splitting (CWE-117).
          console.error(
            '[useDebriefSubscription] subscription error',
            sanitizeForLog(JSON.stringify(err)),
          );
        },
      },
    ).then((unsub) => {
      if (cancelled) {
        unsub();
      } else {
        unsubscribe = unsub;
      }
    }).catch((err: unknown) => {
      // err may carry attacker-influenced text from the WebSocket connection —
      // sanitize before logging to prevent log forgery/splitting (CWE-117).
      console.error(
        '[useDebriefSubscription] failed to connect',
        sanitizeForLog(err instanceof Error ? err.message : String(err)),
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [documentId, enabled, expectedDraftId, queryClient]);
}
