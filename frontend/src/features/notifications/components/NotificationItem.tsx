/**
 * Single notification row in the inbox.
 *
 * Visual distinction: unread notifications have bold styling and a left
 * accent border. Read notifications use normal weight.
 */
import { X } from 'lucide-react';
import type { NotificationView } from '../types/notification';

export interface NotificationItemProps {
  notification: NotificationView;
  onMarkAsRead?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

export function NotificationItem({
  notification,
  onMarkAsRead,
  onDismiss,
}: NotificationItemProps) {
  const isUnread = notification.state === 'unread';

  const handleClick = () => {
    if (isUnread && onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss?.(notification.id);
  };

  const timeAgo = formatTimeAgo(notification.createdAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      className={[
        'group flex items-start gap-sm px-md py-sm border-b border-border-subtle cursor-pointer transition-colors hover:bg-surface-secondary',
        isUnread ? 'bg-accent-primary/5 border-l-2 border-l-accent-primary' : '',
      ].join(' ')}
      aria-label={`${notification.typeLabel}: ${notification.renderedContent}`}
    >
      {/* Unread indicator dot */}
      <div className="mt-[6px] shrink-0">
        {isUnread && (
          <div className="h-[8px] w-[8px] rounded-full bg-accent-primary" aria-hidden="true" />
        )}
        {!isUnread && <div className="h-[8px] w-[8px]" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className={[
          'text-body2 leading-snug',
          isUnread ? 'font-semibold text-text-primary' : 'text-text-secondary',
        ].join(' ')}>
          {notification.renderedContent}
        </p>
        <p className="mt-xs text-caption text-text-muted">
          {notification.typeLabel} · {timeAgo}
        </p>
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-surface-tertiary transition-all"
        aria-label={`Dismiss notification: ${notification.typeLabel}`}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Format a timestamp into a relative time string (e.g., "5m ago", "2h ago"). */
function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 604_800_000) return `${Math.floor(diffMs / 86_400_000)}d ago`;
  return new Date(isoString).toLocaleDateString();
}
