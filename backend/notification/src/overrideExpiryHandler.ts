/**
 * Override expiry handler — invoked by EventBridge every 15 minutes.
 *
 * Scans for overrides that are about to expire (within warning window) or
 * have already expired, and creates notifications for the granting
 * DepartmentAdmin. Uses dedup to avoid repeated notifications for the same
 * override (REQ-NOTIF-DEPTADMIN-01 criteria 6, 7).
 *
 * Emits two event types:
 *   - override-expiring: override will expire within warningHours
 *   - override-expired: override has expired since last check window
 */
import type { NotificationServiceDeps } from './notificationService.js';
import type { NotificationEvent } from './types.js';

export interface OverrideExpiryConfig {
  /** Hours before expiry to trigger warning notification. Default 24. */
  warningHours: number;
  /** Minutes between scheduled invocations (defines the "just expired" window). Default 15. */
  checkIntervalMinutes: number;
}

const DEFAULT_CONFIG: OverrideExpiryConfig = {
  warningHours: 24,
  checkIntervalMinutes: 15,
};

interface OverrideRow {
  id: string;
  granted_by: string;
  writing_type_id: string;
  user_id: string;
  expires_at: string;
  writing_type_name: string;
  student_name: string;
}

/**
 * Check for expiring and expired overrides, returning notification events
 * that should be processed by the NotificationService.
 *
 * The caller (Lambda handler) is responsible for feeding these events into
 * `notificationService.processEvent()` which handles dedup via dedup_key.
 */
export async function checkOverrideExpiry(
  db: NotificationServiceDeps,
  config: Partial<OverrideExpiryConfig> = {},
): Promise<NotificationEvent[]> {
  const { warningHours, checkIntervalMinutes } = { ...DEFAULT_CONFIG, ...config };
  const events: NotificationEvent[] = [];

  // 1. Find overrides expiring within the warning window (not yet expired)
  const expiringRows = await db.query<OverrideRow>(
    `SELECT o.id, o.granted_by, o.writing_type_id, o.user_id, o.expires_at,
            wt.name AS writing_type_name,
            CONCAT(u.first_name, ' ', u.last_name) AS student_name
     FROM usage_override o
     JOIN writing_type wt ON o.writing_type_id = wt.id
     JOIN app_user u ON o.user_id = u.id
     WHERE o.expires_at > NOW()
       AND o.expires_at <= NOW() + INTERVAL '1 hour' * $1
       AND o.revoked_at IS NULL`,
    [warningHours],
  );

  for (const row of expiringRows) {
    events.push({
      typeSlug: 'override-expiring',
      entityId: row.id,
      recipientUserId: row.granted_by,
      context: {
        overrideId: row.id,
        studentName: row.student_name,
        documentTypeName: row.writing_type_name,
      },
    });
  }

  // 2. Find overrides that have expired within the last check interval
  const expiredRows = await db.query<OverrideRow>(
    `SELECT o.id, o.granted_by, o.writing_type_id, o.user_id, o.expires_at,
            wt.name AS writing_type_name,
            CONCAT(u.first_name, ' ', u.last_name) AS student_name
     FROM usage_override o
     JOIN writing_type wt ON o.writing_type_id = wt.id
     JOIN app_user u ON o.user_id = u.id
     WHERE o.expires_at <= NOW()
       AND o.expires_at > NOW() - INTERVAL '1 minute' * $1
       AND o.revoked_at IS NULL`,
    [checkIntervalMinutes],
  );

  for (const row of expiredRows) {
    events.push({
      typeSlug: 'override-expired',
      entityId: row.id,
      recipientUserId: row.granted_by,
      context: {
        overrideId: row.id,
        studentName: row.student_name,
        documentTypeName: row.writing_type_name,
      },
    });
  }

  return events;
}
