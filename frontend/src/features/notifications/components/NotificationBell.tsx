/**
 * Notification bell icon with unread badge.
 *
 * Positioned in the dashboard header for all three role dashboards.
 * Shows the unread count badge when > 0. On click, toggles the
 * NotificationInbox popover.
 */
import { Bell } from 'lucide-react';
import { useState, useCallback } from 'react';
import { NotificationInbox } from './NotificationInbox';

export interface NotificationBellProps {
  unreadCount: number;
  onToggleInbox?: (isOpen: boolean) => void;
}

export function NotificationBell({ unreadCount, onToggleInbox }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    setIsOpen(next);
    onToggleInbox?.(next);
  }, [isOpen, onToggleInbox]);

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
          <NotificationInbox onClose={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
}
