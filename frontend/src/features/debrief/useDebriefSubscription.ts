/**
 * useDebriefSubscription — AppSync real-time subscription for debrief-ready
 * notifications.
 *
 * When the Feedback Engine finishes writing feedback_item rows it publishes a
 * `publishDebriefReady` mutation. This hook subscribes to `onDebriefReady` and,
 * on receipt, fetches the full debrief via REST then updates the React Query
 * cache.
 *
 * Uses a raw WebSocket implementation (appSyncClient.ts) so auth is handled
 * directly with the idToken from CognitoAuthService — no Amplify auth stack.
 *
 * When VITE_APPSYNC_URL is absent (local/mock mode) subscribeToAppSync() is a
 * no-op and the polling fallback in DocumentEditorPage handles completion.
 *
 * The `onComplete` callback is called after the cache is updated so the caller
 * can clear its "is generating" state.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { subscribeToAppSync } from '@/services/appSyncClient';
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

export function useDebriefSubscription(
  documentId: string,
  enabled: boolean,
  onComplete: () => void,
): void {
  const queryClient = useQueryClient();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!enabled || !documentId) return;

    const unsubscribe = subscribeToAppSync(
      ON_DEBRIEF_READY_SUBSCRIPTION,
      { documentId },
      {
        next: (payload: unknown) => {
          const parsed = debriefReadyPayloadSchema.safeParse(payload);
          if (!parsed.success) return;

          const { draftId } = parsed.data.data.onDebriefReady;

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
          console.error(
            '[useDebriefSubscription] subscription error',
            JSON.stringify(err),
          );
        },
      },
    );

    return unsubscribe;
  }, [documentId, enabled, queryClient]);
}
