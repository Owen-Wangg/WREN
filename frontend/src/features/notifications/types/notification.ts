/** Notification lifecycle state. */
export type NotificationState = 'unread' | 'read' | 'dismissed';

/** A single notification as displayed in the inbox. */
export interface NotificationView {
  id: string;
  typeSlug: string;
  typeLabel: string;
  renderedContent: string;
  state: NotificationState;
  createdAt: string;
  actionUrl: string | null;
}

/** Paginated inbox response from the API. */
export interface PaginatedInbox {
  notifications: NotificationView[];
  nextCursor: string | null;
  unreadCount: number;
}

/** Options for inbox query. */
export interface InboxQueryOptions {
  cursor?: string;
  limit?: number;
  stateFilter?: 'unread' | 'read';
}

/** Payload received via AppSync subscription for new notifications. */
export interface NotificationPayload {
  id: string;
  typeSlug: string;
  typeLabel: string;
  renderedContent: string;
  actionUrl?: string | null;
  createdAt: string;
}

/** Payload received via AppSync subscription for state changes. */
export interface NotificationStateChange {
  notificationId: string;
  newState: NotificationState;
}

/** Bulk action types. */
export type BulkAction = 'markAllRead' | 'dismissAll';
