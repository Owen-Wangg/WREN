/**
 * Notification_Service — Core interfaces and types.
 *
 * All notifications are in-app only (REQ-NOTIF-CHANNEL-01). The service resolves
 * recipients exclusively from the application database (REQ-NOTIF-AUTHZ-01),
 * never from IdP claims or client state.
 */

/* -------------------------------------------------------------------------- */
/* Notification Event (inbound from SNS/SQS)                                   */
/* -------------------------------------------------------------------------- */

/** Structured event published by producers to the internal SNS topic. */
export interface NotificationEvent {
  /** Slug of the Notification_Type catalog entry (e.g., "ai-debrief-ready"). */
  typeSlug: string;
  /** The entity that triggered this notification (draftId, accessGrantId, etc.). */
  entityId: string;
  /** Type-specific context for template interpolation. */
  context: Record<string, string>;
  /** Optional: explicit recipient userId (for single-recipient types). */
  recipientUserId?: string;
  /** Optional: departmentId for dept-scoped admin notifications. */
  departmentId?: string;
  /** Optional: documentTypeId for doc-type-scoped notifications. */
  documentTypeId?: string;
}

/* -------------------------------------------------------------------------- */
/* Notification_Type (catalog entry)                                            */
/* -------------------------------------------------------------------------- */

export interface DedupStrategy {
  enabled: boolean;
  windowMinutes?: number;
  keyFields?: string[];
}

export interface NotificationType {
  id: string;
  slug: string;
  label: string;
  displayTemplate: string;
  actionUrlTemplate: string | null;
  targetRoles: TargetRole[];
  dedupStrategy: DedupStrategy;
  createdAt: string;
  updatedAt: string;
}

export type TargetRole = 'Student' | 'DepartmentAdmin' | 'TechnicalAdmin';

/* -------------------------------------------------------------------------- */
/* Notification record                                                         */
/* -------------------------------------------------------------------------- */

export type NotificationState = 'unread' | 'read' | 'dismissed';

export interface NotificationRecord {
  id: string;
  notificationTypeId: string;
  recipientUserId: string;
  state: NotificationState;
  renderedContent: string;
  actionUrl: string | null;
  dedupKey: string | null;
  context: Record<string, string> | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Inbox query                                                                 */
/* -------------------------------------------------------------------------- */

export interface InboxOptions {
  /** Opaque cursor for keyset pagination. */
  cursor?: string;
  /** Page size. Default 20, max 100. */
  limit?: number;
  /** Optional lifecycle state filter. */
  stateFilter?: 'unread' | 'read';
}

export interface PaginatedInbox {
  notifications: NotificationView[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationView {
  id: string;
  typeSlug: string;
  typeLabel: string;
  renderedContent: string;
  state: 'unread' | 'read';
  createdAt: string;
  actionUrl: string | null;
}

/* -------------------------------------------------------------------------- */
/* Service interface                                                            */
/* -------------------------------------------------------------------------- */

export interface ProcessResult {
  /** Number of notification records actually created (after dedup). */
  created: number;
  /** Number of recipients that were deduplicated (skipped). */
  deduplicated: number;
}

export interface NotificationService {
  /** Process an incoming notification event — resolve recipients, dedup, persist, push. */
  processEvent(event: NotificationEvent): Promise<ProcessResult>;

  /** Fetch a user's inbox (paginated, filterable). */
  getInbox(userId: string, options: InboxOptions): Promise<PaginatedInbox>;

  /** Transition notification state (read, dismissed). */
  transitionState(
    notificationId: string,
    userId: string,
    newState: 'read' | 'dismissed',
  ): Promise<void>;

  /** Bulk transition: mark all as read or dismiss all. */
  bulkTransition(userId: string, action: 'markAllRead' | 'dismissAll'): Promise<number>;

  /** Get unread count for badge display. */
  getUnreadCount(userId: string): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Catalog service (Technical Admin only)                                       */
/* -------------------------------------------------------------------------- */

export interface CreateNotificationTypeInput {
  slug: string;
  label: string;
  targetRoles: TargetRole[];
  displayTemplate: string;
  actionUrlTemplate?: string;
  dedupStrategy: DedupStrategy;
}

export interface UpdateNotificationTypeInput {
  label?: string;
  targetRoles?: TargetRole[];
  displayTemplate?: string;
  actionUrlTemplate?: string | null;
  dedupStrategy?: DedupStrategy;
}

export interface NotificationTypeCatalogService {
  /** Create a new Notification_Type (Technical Admin only). */
  create(input: CreateNotificationTypeInput): Promise<NotificationType>;
  /** Update an existing Notification_Type (Technical Admin only). */
  update(id: string, input: UpdateNotificationTypeInput): Promise<NotificationType>;
  /** List all Notification_Types. */
  list(): Promise<NotificationType[]>;
}
