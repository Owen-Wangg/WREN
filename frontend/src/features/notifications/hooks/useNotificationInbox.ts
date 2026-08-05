/**
 * React Query hook for the notification inbox.
 *
 * Provides paginated inbox fetching with cursor-based pagination,
 * state filtering, and cache invalidation on state transitions.
 */
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { HttpClient } from '@/services/apiClient';
import { getInbox } from '../services/notificationApi';
import type { PaginatedInbox, InboxQueryOptions } from '../types/notification';

export const NOTIFICATION_INBOX_KEY = ['notifications', 'inbox'] as const;
export const NOTIFICATION_UNREAD_COUNT_KEY = ['notifications', 'unreadCount'] as const;

export interface UseNotificationInboxOptions {
  client: HttpClient;
  stateFilter?: 'unread' | 'read';
  enabled?: boolean;
}

export function useNotificationInbox(options: UseNotificationInboxOptions) {
  const { client, stateFilter, enabled = true } = options;

  const query = useInfiniteQuery<PaginatedInbox, Error>({
    queryKey: [...NOTIFICATION_INBOX_KEY, { stateFilter }],
    queryFn: async ({ pageParam }) => {
      const queryOptions: InboxQueryOptions = {
        limit: 20,
        stateFilter,
        cursor: pageParam as string | undefined,
      };
      return getInbox(client, queryOptions);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });

  return query;
}

/** Hook to invalidate notification caches (call after mutations or subscription events). */
export function useInvalidateNotifications() {
  const queryClient = useQueryClient();

  const invalidateInbox = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATION_INBOX_KEY });
  }, [queryClient]);

  const invalidateUnreadCount = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATION_UNREAD_COUNT_KEY });
  }, [queryClient]);

  const invalidateAll = useCallback(() => {
    invalidateInbox();
    invalidateUnreadCount();
  }, [invalidateInbox, invalidateUnreadCount]);

  return { invalidateInbox, invalidateUnreadCount, invalidateAll };
}
