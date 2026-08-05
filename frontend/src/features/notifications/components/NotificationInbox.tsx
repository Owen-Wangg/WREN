/**
 * Notification inbox popover/panel.
 *
 * Displays a paginated list of notifications ordered by creation time (most
 * recent first). Supports filter tabs (All, Unread), bulk actions, and
 * infinite scroll / load-more pagination.
 */
import { useState } from 'react';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { NotificationItem } from './NotificationItem';
import type { NotificationView, BulkAction } from '../types/notification';

export interface NotificationInboxProps {
  notifications?: NotificationView[];
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
  onMarkAsRead?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onBulkAction?: (action: BulkAction) => void;
  onClose?: () => void;
  stateFilter?: 'unread' | 'read' | null;
  onFilterChange?: (filter: 'unread' | 'read' | null) => void;
}

export function NotificationInbox({
  notifications = [],
  hasMore = false,
  isLoading = false,
  onLoadMore,
  onMarkAsRead,
  onDismiss,
  onBulkAction,
  onClose,
  stateFilter = null,
  onFilterChange,
}: NotificationInboxProps) {
  const [activeFilter, setActiveFilter] = useState<'unread' | 'read' | null>(stateFilter);

  const handleFilterChange = (filter: 'unread' | 'read' | null) => {
    setActiveFilter(filter);
    onFilterChange?.(filter);
  };

  return (
    <div
      className="w-[380px] max-h-[480px] rounded-lg border border-border-subtle bg-surface-primary shadow-lg flex flex-col overflow-hidden"
      role="dialog"
      aria-label="Notification inbox"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-md py-sm">
        <h2 className="text-heading4 font-semibold text-text-primary">Notifications</h2>
        <div className="flex items-center gap-xs">
          {onBulkAction && (
            <>
              <button
                type="button"
                onClick={() => onBulkAction('markAllRead')}
                className="rounded p-xs text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
                title="Mark all as read"
                aria-label="Mark all notifications as read"
              >
                <CheckCheck size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onBulkAction('dismissAll')}
                className="rounded p-xs text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
                title="Dismiss all"
                aria-label="Dismiss all notifications"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-xs text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
              aria-label="Close notifications"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-border-subtle px-md">
        {([null, 'unread', 'read'] as const).map((filter) => (
          <button
            key={filter ?? 'all'}
            type="button"
            onClick={() => handleFilterChange(filter)}
            className={[
              'px-sm py-xs text-caption font-medium transition-colors border-b-2 -mb-px',
              activeFilter === filter
                ? 'border-accent-primary text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            ].join(' ')}
          >
            {filter === null ? 'All' : filter === 'unread' ? 'Unread' : 'Read'}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-xl text-text-muted">
            <Bell size={32} className="mb-sm opacity-40" aria-hidden="true" />
            <p className="text-body2">No notifications</p>
          </div>
        )}

        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkAsRead={onMarkAsRead}
            onDismiss={onDismiss}
          />
        ))}

        {/* Load more */}
        {hasMore && (
          <div className="px-md py-sm">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isLoading}
              className="w-full rounded-md py-xs text-caption font-medium text-accent-primary hover:bg-surface-secondary transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
