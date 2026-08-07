/**
 * Notification bell icon with unread badge.
 *
 * Positioned in the dashboard header for all three role dashboards.
 * Shows the unread count badge when > 0. On click, toggles the
 * NotificationInbox popover wired to live data via hooks.
 */
import { Bell } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useApiClient } from '@/services/apiClient';
import { NotificationInbox } from './NotificationInbox';
import { useNotificationInbox } from '../hooks/useNotificationInbox';
import { useNotificationActions } from '../hooks/useNotificationActions';
import type { BulkAction } from '../types/notification';

export interface NotificationBellProps {
  unreadCount: number;
  onToggleInbox?: (isOpen: boolean) => void;
}

export function NotificationBell({ unreadCount, onToggleInbox }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [stateFilter, setStateFilter] = useState<'unread' | 'read' | null>(null);
  const client = useApiClient();

  const inboxQuery = useNotificationInbox({
    client,
    stateFilter: stateFilter ?? undefined,
    enabled: isOpen,
  });

  const { markAsRead, dismiss, bulk } = useNotificationActions({ client });

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    setIsOpen(next);
    onToggleInbox?.(next);
  }, [isOpen, onToggleInbox]);

  // Flatten paginated results into a single array.
  const notifications = inboxQuery.data?.pages.flatMap((page) => page.notifications) ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative flex items-center justify-center rounded-md p-sm text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell size={22} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-primary px-xs text-[11px] font-semibold text-white"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-sm z-50">
          <NotificationInbox
            notifications={notifications}
            hasMore={inboxQuery.hasNextPage ?? false}
            isLoading={inboxQuery.isLoading || inboxQuery.isFetchingNextPage}
            onLoadMore={() => inboxQuery.fetchNextPage()}
            onMarkAsRead={(id) => markAsRead.mutate(id)}
            onDismiss={(id) => dismiss.mutate(id)}
            onBulkAction={(action: BulkAction) => bulk.mutate(action)}
            onClose={() => setIsOpen(false)}
            stateFilter={stateFilter}
            onFilterChange={setStateFilter}
          />
        </div>
      )}
    </div>
  );
}
