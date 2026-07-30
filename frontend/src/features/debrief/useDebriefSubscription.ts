/**
 * useDebriefSubscription — AppSync real-time subscription for debrief-ready
 * notifications (replaces the setInterval polling loop in DocumentEditorPage).
 *
 * When the Feedback Engine finishes writing feedback_item rows it publishes a
 * `publishDebriefReady` mutation. This hook subscribes to `onDebriefReady` and,
 * on receipt, fetches the full debrief via REST then updates the React Query
 * cache — identical to what the polling callback did, but triggered immediately.
 *
 * The subscription payload is validated with Zod before touching the cache
 * (frontend steering §7: "validate API responses at the boundary").
 *
 * When appSyncClient is null (VITE_APPSYNC_URL absent in local/mock mode) the
 * hook is a no-op — the polling fallback in DocumentEditorPage still works.
 *
 * The `onComplete` callback is called after the cache is updated so the caller
 * can clear its "is generating" state.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { appSyncClient } from '@/services/appSyncClient';
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
  documentId: z.string(),
  draftId: z.string(),
  itemCount: z.number().int().nonnegative(),
});

export function useDebriefSubscription(
  documentId: string,
  enabled: boolean,
  onComplete: () => void,
): void {
  const queryClient = useQueryClient();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!enabled || !documentId || !appSyncClient) return;

    // graphql() returns unknown (our AppSyncGraphQLClient type). At runtime
    // AppSync subscriptions return an observable with .subscribe(); we cast
    // through unknown to access it without importing Amplify's deep generics.
    const observable = appSyncClient.graphql({
      query: ON_DEBRIEF_READY_SUBSCRIPTION,
      variables: { documentId },
      authMode: 'userPool',
    }) as { subscribe: (handlers: { next: (v: { data: unknown }) => void; error: (e: unknown) => void }) => { unsubscribe: () => void } };

    const sub = observable.subscribe({
        next: ({ data }: { data: unknown }) => {
          const raw = (data as Record<string, unknown>)?.['onDebriefReady'];
          const parsed = debriefReadyPayloadSchema.safeParse(raw);
          if (!parsed.success) return;

          const { draftId } = parsed.data;

          // Fetch the full debrief via REST — the subscription is a signal, not
          // a data carrier (frontend steering §7: validate at the boundary).
          void fetchDebrief(apiClient, documentId).then((debrief) => {
            queryClient.setQueryData(queryKeys.debrief(documentId), debrief);
            if (draftId && draftId !== 'none') {
              queryClient.setQueryData(
                queryKeys.debrief(documentId, draftId),
                debrief,
              );
            }
            void queryClient.invalidateQueries({
              queryKey: [...queryKeys.debrief(documentId).slice(0, 4)],
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.debriefHistory(documentId),
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.inlineFeedbackItems(documentId),
            });
            onCompleteRef.current();
          });
        },
        error: (err: unknown) => {
          const detail =
            err && typeof err === 'object' && 'errors' in err
              ? JSON.stringify((err as { errors: unknown }).errors)
              : String(err);
          console.error('[useDebriefSubscription] subscription error', detail);
          // Non-fatal: the polling fallback in DocumentEditorPage handles
          // completion while AppSync is being verified in production.
        },
      });

    return () => {
      sub.unsubscribe();
    };
  }, [documentId, enabled, queryClient]);
}
