/**
 * Notification toast and stack manager.
 *
 * NotificationToast: transient display with auto-dismiss after configurable
 * duration (default 5000ms).
 * NotificationToastStack: manages max 3 visible toasts simultaneously with
 * "+N more" consolidation for overflow. Ordered by creation time (FIFO).
 * Toast dismissal does not affect inbox notification state.
 *
 * Uses aria-live for accessibility announcements.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Bell } from 'lucide-react';
import type { NotificationPayload } from '../types/notification';

/* -------------------------------------------------------------------------- */
/* NotificationToast                                                           */
/* -------------------------------------------------------------------------- */

export interface NotificationToastProps {
  notification: NotificationPayload;
  /** Auto-dismiss duration in ms. Default 5000. */
  duration?: number;
  onDismiss: (id: string) => void;
}

export function NotificationToast({
  notification,
  duration = 5000,
  onDismiss,
}: NotificationToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(notification.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [notification.id, duration, onDismiss]);

  return (
    <div
      className="flex items-start gap-sm rounded-lg border border-border-subtle bg-surface-primary p-sm shadow-md animate-in slide-in-from-top-2 fade-in duration-200 max-w-[340px]"
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0 mt-px">
        <Bell size={16} className="text-accent-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-body2 font-medium text-text-primary leading-snug truncate">
          {notification.typeLabel}
        </p>
        <p className="text-caption text-text-secondary mt-xs line-clamp-2">
          {notification.renderedContent}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        className="shrink-0 rounded p-xs text-text-muted hover:text-text-primary transition-colors"
        aria-label="Dismiss toast"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* NotificationToastStack                                                      */
/* -------------------------------------------------------------------------- */

export interface NotificationToastStackProps {
  /** Maximum number of simultaneously visible toasts. Default 3. */
  maxVisible?: number;
  /** Auto-dismiss duration in ms for each toast. Default 5000. */
  duration?: number;
}

/**
 * Manages a stack of notification toasts. Add toasts via the returned `push`
 * function. Automatically dismisses after `duration` ms.
 */
export function useNotificationToastStack(
  options: NotificationToastStackProps = {},
) {
  const { maxVisible = 3, duration = 5000 } = options;
  const [toasts, setToasts] = useState<NotificationPayload[]>([]);

  const push = useCallback((notification: NotificationPayload) => {
    setToasts((prev) => [...prev, notification]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const visibleToasts = toasts.slice(0, maxVisible);
  const overflowCount = Math.max(0, toasts.length - maxVisible);

  return { toasts: visibleToasts, overflowCount, push, dismiss, duration };
}

export interface ToastStackRendererProps {
  toasts: NotificationPayload[];
  overflowCount: number;
  duration: number;
  onDismiss: (id: string) => void;
}

export function ToastStackRenderer({
  toasts,
  overflowCount,
  duration,
  onDismiss,
}: ToastStackRendererProps) {
  return (
    <div
      className="fixed top-md right-md z-[100] flex flex-col gap-sm pointer-events-auto"
      aria-label="Notification toasts"
    >
      {toasts.map((toast) => (
        <NotificationToast
          key={toast.id}
          notification={toast}
          duration={duration}
          onDismiss={onDismiss}
        />
      ))}
      {overflowCount > 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-secondary px-sm py-xs text-center text-caption text-text-muted shadow-sm">
          +{overflowCount} more notification{overflowCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
