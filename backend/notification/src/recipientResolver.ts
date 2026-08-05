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
 * - DepartmentAdmin: all Org Owners whose scope includes the relevant department
 * - TechnicalAdmin: all users with the Admin role
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
        // Resolve all Org Owners whose scope includes the relevant department.
        // If departmentId is provided directly, use it. Otherwise, resolve via
        // the writing_type (Document Type) → organization FK.
        let departmentId = event.departmentId;

        if (!departmentId && event.documentTypeId) {
          const orgRows = await deps.query<{ organization_id: string }>(
            `SELECT organization_id FROM writing_type WHERE id = $1`,
            [event.documentTypeId],
          );
          departmentId = orgRows[0]?.organization_id;
        }

        if (!departmentId) break;

        // Query Org Owners scoped to this department/organization
        const rows = await deps.query<{ user_id: string }>(
          `SELECT DISTINCT ra.user_id
           FROM role_assignment ra
           WHERE ra.role = 'Org Owner'
             AND ra.scope->>'organizationId' = $1`,
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
        // Resolve all users with the Admin role
        const rows = await deps.query<{ user_id: string }>(
          `SELECT DISTINCT ra.user_id
           FROM role_assignment ra
           WHERE ra.role = 'Admin'`,
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
