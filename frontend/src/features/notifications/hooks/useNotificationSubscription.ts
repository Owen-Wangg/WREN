/**
 * Real-time notification subscription hook.
 *
 * Subscribes to onNotification and onNotificationStateChange AppSync
 * subscriptions for the authenticated user. On disconnect, triggers a REST
 * refetch of the inbox on reconnect. Deduplicates by notification id.
 */
import { useEffect, useRef, useCallback } from 'react';
import { subscribeToAppSync } from '@/services/appSyncClient';
import type { NotificationPayload, NotificationStateChange } from '../types/notification';

export interface UseNotificationSubscriptionOptions {
  /** The authenticated user's ID (recipientUserId for the subscription filter). */
  userId: string | null;
  /** Called when a new notification arrives via the subscription. */
  onNotification: (payload: NotificationPayload) => void;
  /** Called when a notification state change arrives (multi-session sync). */
  onStateChange: (payload: NotificationStateChange) => void;
  /** Called when the subscription reconnects (trigger inbox refetch). */
  onReconnect?: () => void;
  /** Whether the subscription is enabled (default true). */
  enabled?: boolean;
}

const ON_NOTIFICATION_QUERY = `subscription OnNotification($recipientUserId: ID!) {
  onNotification(recipientUserId: $recipientUserId) {
    id
    typeSlug
    typeLabel
    renderedContent
    actionUrl
    createdAt
  }
}`;

const ON_STATE_CHANGE_QUERY = `subscription OnNotificationStateChange($recipientUserId: ID!) {
  onNotificationStateChange(recipientUserId: $recipientUserId) {
    notificationId
    newState
  }
}`;

export function useNotificationSubscription(options: UseNotificationSubscriptionOptions): void {
  const { userId, onNotification, onStateChange, onReconnect, enabled = true } = options;
  const unsubNotifRef = useRef<(() => void) | null>(null);
  const unsubStateRef = useRef<(() => void) | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const handleNotification = useCallback(
    (data: unknown) => {
      const payload = (data as { onNotification?: NotificationPayload })?.onNotification;
      if (!payload) return;
      // Deduplicate by notification id
      if (seenIdsRef.current.has(payload.id)) return;
      seenIdsRef.current.add(payload.id);
      onNotification(payload);
    },
    [onNotification],
  );

  const handleStateChange = useCallback(
    (data: unknown) => {
      const payload = (data as { onNotificationStateChange?: NotificationStateChange })?.onNotificationStateChange;
      if (!payload) return;
      onStateChange(payload);
    },
    [onStateChange],
  );

  useEffect(() => {
    if (!enabled || !userId) return;

    let cancelled = false;

    const subscribe = async () => {
      try {
        const unsubNotif = await subscribeToAppSync(
          ON_NOTIFICATION_QUERY,
          { recipientUserId: userId },
          {
            next: handleNotification,
            error: () => {
              // On error/disconnect, trigger reconnect handler
              if (!cancelled && onReconnect) onReconnect();
            },
          },
        );
        if (!cancelled) unsubNotifRef.current = unsubNotif;
        else unsubNotif();
      } catch {
        // AppSync URL not configured or connection failed — silent fallback
      }

      try {
        const unsubState = await subscribeToAppSync(
          ON_STATE_CHANGE_QUERY,
          { recipientUserId: userId },
          {
            next: handleStateChange,
            error: () => {},
          },
        );
        if (!cancelled) unsubStateRef.current = unsubState;
        else unsubState();
      } catch {
        // Silent fallback
      }
    };

    subscribe();

    return () => {
      cancelled = true;
      unsubNotifRef.current?.();
      unsubStateRef.current?.();
      unsubNotifRef.current = null;
      unsubStateRef.current = null;
    };
  }, [userId, enabled, handleNotification, handleStateChange, onReconnect]);
}
