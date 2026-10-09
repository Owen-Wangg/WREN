/**
 * Recipient resolution — determines the set of users who should receive a
 * notification based on the Notification_Type's target roles and the event's
 * scoping context.
 *
 * Recipients are resolved EXCLUSIVELY from the application database
 * (role_assignment + department scope). Never from IdP claims, token attributes,
 * or client state (REQ-NOTIF-AUTHZ-01).
 */
import type { NotificationEvent, TargetRole } from './types.js';

export interface RecipientResolverDeps {
  query: <Row = Record<string, unknown>>(text: string, params: readonly unknown[]) => Promise<Row[]>;
}

export interface ResolvedRecipient {
  userId: string;
}

/**
 * Resolve the set of recipients for a notification event.
 *
 * Resolution strategy by target role:
 * - Student: explicit recipientUserId from event (single-recipient)
 * - DepartmentAdmin: all `DepartmentAdmin` role assignments scoped to the
 *   relevant department (event.departmentId, or document_type.department_id)
 * - TechnicalAdmin: all users with the global `TechnicalAdmin` role
 *
 * Role literals and the scope JSONB shape MUST match the `role_assignment`
 * CHECK constraint (0001_baseline.sql) and the writer in
 * backend/admin/src/roleAssignmentService.ts (`{ departmentId }`, plus the
 * legacy `{ departmentIds: [...] }` shape).
 */
export async function recipientResolver(
  event: NotificationEvent,
  targetRoles: TargetRole[],
  deps: RecipientResolverDeps,
): Promise<ResolvedRecipient[]> {
  const recipients: ResolvedRecipient[] = [];

  // Single-recipient path: explicit userId provided in event
  if (event.recipientUserId) {
    recipients.push({ userId: event.recipientUserId });
    return recipients;
  }

  // Multi-recipient resolution from the application database
  for (const role of targetRoles) {
    switch (role) {
      case 'Student': {
        // Student notifications require explicit recipientUserId — skip if not provided
        break;
      }
      case 'DepartmentAdmin': {
        // Resolve all Department Admins scoped to the relevant department.
        // If departmentId is provided directly, use it. Otherwise, resolve via
        // the document_type → department FK.
        let departmentId = event.departmentId;

        if (!departmentId && event.documentTypeId) {
          const deptRows = await deps.query<{ department_id: string | null }>(
            `SELECT department_id FROM document_type WHERE id = $1`,
            [event.documentTypeId],
          );
          departmentId = deptRows[0]?.department_id ?? undefined;
        }

        if (!departmentId) break;

        // Match the current `{ departmentId }` scope and the legacy
        // `{ departmentIds: [...] }` shape (same predicate as
        // roleAssignmentService.findDeptScopedAssignment).
        const rows = await deps.query<{ user_id: string }>(
          `SELECT DISTINCT ra.user_id
           FROM role_assignment ra
           WHERE ra.role = 'DepartmentAdmin'
             AND (
               ra.scope->>'departmentId' = $1
               OR ra.scope->'departmentIds' ? $1
             )`,
          [departmentId],
        );
        for (const row of rows) {
          if (!recipients.some((r) => r.userId === row.user_id)) {
            recipients.push({ userId: row.user_id });
          }
        }
        break;
      }
      case 'TechnicalAdmin': {
        // Resolve all users with the global TechnicalAdmin role
        const rows = await deps.query<{ user_id: string }>(
          `SELECT DISTINCT ra.user_id
           FROM role_assignment ra
           WHERE ra.role = 'TechnicalAdmin'`,
          [],
        );
        for (const row of rows) {
          if (!recipients.some((r) => r.userId === row.user_id)) {
            recipients.push({ userId: row.user_id });
          }
        }
        break;
      }
    }
  }

  return recipients;
}
