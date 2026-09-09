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
 *
 * Queries the V4 `override` table (joined to `document_type` / `app_user`).
 * There is no `usage_override` or `writing_type` relation — those names were
 * the pre-V4 schema and are what produced `relation "usage_override" does
 * not exist` on the scheduled scan.
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
  document_type_id: string;
  user_id: string;
  expires_at: string;
  document_type_name: string;
  student_name: string;
}

/** Shared projection against the live `override` schema (post-V4). */
const OVERRIDE_EXPIRY_SELECT = `SELECT o.id, o.granted_by, o.document_type_id, o.user_id, o.expires_at,
            dt.name AS document_type_name,
            CONCAT(u.first_name, ' ', u.last_name) AS student_name
     FROM override o
     JOIN document_type dt ON o.document_type_id = dt.id
     JOIN app_user u ON o.user_id = u.id`;

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

  // 1. Find overrides expiring within the warning window (not yet expired).
  // `granted_by` is nullable (SET NULL when the grantor is deleted); skip those.
  const expiringRows = await db.query<OverrideRow>(
    `${OVERRIDE_EXPIRY_SELECT}
     WHERE o.expires_at > NOW()
       AND o.expires_at <= NOW() + INTERVAL '1 hour' * $1
       AND o.granted_by IS NOT NULL`,
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
        documentTypeName: row.document_type_name,
      },
    });
  }

  // 2. Find overrides that have expired within the last check interval.
  const expiredRows = await db.query<OverrideRow>(
    `${OVERRIDE_EXPIRY_SELECT}
     WHERE o.expires_at <= NOW()
       AND o.expires_at > NOW() - INTERVAL '1 minute' * $1
       AND o.granted_by IS NOT NULL`,
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
        documentTypeName: row.document_type_name,
      },
    });
  }

  return events;
}
