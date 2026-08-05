/**
 * Mutation hooks for notification actions.
 *
 * Provides optimistic-update mutations for mark-as-read, dismiss, and bulk
 * actions with automatic cache invalidation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { HttpClient } from '@/services/apiClient';
import { transitionState, bulkAction, getUnreadCount } from '../services/notificationApi';
import type { BulkAction } from '../types/notification';
import { NOTIFICATION_INBOX_KEY, NOTIFICATION_UNREAD_COUNT_KEY } from './useNotificationInbox';

export interface UseNotificationActionsOptions {
  client: HttpClient;
}

export function useNotificationActions(options: UseNotificationActionsOptions) {
  const { client } = options;
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATION_INBOX_KEY });
    queryClient.invalidateQueries({ queryKey: NOTIFICATION_UNREAD_COUNT_KEY });
  }, [queryClient]);

  const markAsRead = useMutation({
    mutationFn: (notificationId: string) => transitionState(client, notificationId, 'read'),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (notificationId: string) => transitionState(client, notificationId, 'dismissed'),
    onSuccess: invalidate,
  });

  const bulk = useMutation({
    mutationFn: (action: BulkAction) => bulkAction(client, action),
    onSuccess: invalidate,
  });

  return { markAsRead, dismiss, bulk };
}

export interface UseUnreadCountOptions {
  client: HttpClient;
  enabled?: boolean;
}

/** Hook to fetch and cache the unread notification count for the badge. */
export function useUnreadCount(options: UseUnreadCountOptions) {
  const { client, enabled = true } = options;

  return useQuery({
    queryKey: NOTIFICATION_UNREAD_COUNT_KEY,
    queryFn: () => getUnreadCount(client),
    enabled,
    // Refetch every 30 seconds as a fallback when subscriptions are down
    refetchInterval: 30_000,
  });
}
