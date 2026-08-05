/**
 * `@wren/notification` — In-app Notification_Service for WREN Writing Coach
 * (Node 22).
 *
 * Processes notification events from SNS/SQS, resolves recipients from the
 * application database, deduplicates, renders templates with sanitization,
 * persists to PostgreSQL, and publishes real-time updates via AppSync.
 *
 * All notifications are in-app only — no email/SMS (REQ-NOTIF-CHANNEL-01).
 */
export type {
  NotificationEvent,
  NotificationType,
  NotificationRecord,
  NotificationState,
  NotificationView,
  NotificationService,
  NotificationTypeCatalogService,
  CreateNotificationTypeInput,
  UpdateNotificationTypeInput,
  DedupStrategy,
  TargetRole,
  InboxOptions,
  PaginatedInbox,
  ProcessResult,
} from './types.js';

export { recipientResolver } from './recipientResolver.js';
export { lifecycleStateMachine, isTerminalState, type TransitionResult } from './lifecycle.js';
export { buildDedupKey } from './dedup.js';
export { renderTemplate, renderActionUrl, sanitizeValue } from './templateRenderer.js';
export { validateNoLeakConstraint, type NoLeakValidationResult } from './noLeakValidation.js';
