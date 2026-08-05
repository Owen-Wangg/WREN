/**
 * NotificationService implementation — processes events, manages inbox,
 * and handles state transitions for in-app notifications.
 */
import type {
  NotificationEvent,
  NotificationService,
  NotificationState,
  NotificationView,
  InboxOptions,
  PaginatedInbox,
  ProcessResult,
  TargetRole,
  DedupStrategy,
} from './types.js';
import { recipientResolver, type RecipientResolverDeps } from './recipientResolver.js';
import { lifecycleStateMachine } from './lifecycle.js';
import { buildDedupKey } from './dedup.js';
import { renderTemplate, renderActionUrl } from './templateRenderer.js';

export interface NotificationServiceDeps {
  query: <Row = Record<string, unknown>>(text: string, params: readonly unknown[]) => Promise<Row[]>;
  execute: (text: string, params: readonly unknown[]) => Promise<number>;
}

class NotificationServiceImpl implements NotificationService {
  private readonly db: NotificationServiceDeps;

  constructor(db: NotificationServiceDeps) {
    this.db = db;
  }

  async processEvent(event: NotificationEvent): Promise<ProcessResult> {
    // 1. Look up notification_type by slug
    const typeRows = await this.db.query<{
      id: string;
      slug: string;
      display_template: string;
      action_url_template: string | null;
      target_roles: string | TargetRole[];
      dedup_strategy: string | DedupStrategy;
    }>(
      `SELECT id, slug, display_template, action_url_template, target_roles, dedup_strategy
       FROM notification_type WHERE slug = $1`,
      [event.typeSlug],
    );

    if (typeRows.length === 0) {
      throw new Error(`Notification type not found: ${event.typeSlug}`);
    }

    const typeRow = typeRows[0];
    const notificationTypeId = typeRow.id;
    const displayTemplate = typeRow.display_template;
    const actionUrlTemplate = typeRow.action_url_template;

    // 2. Parse target_roles and dedup_strategy (may be string or already parsed)
    const targetRoles: TargetRole[] =
      typeof typeRow.target_roles === 'string'
        ? JSON.parse(typeRow.target_roles)
        : typeRow.target_roles;
    const dedupStrategy: DedupStrategy =
      typeof typeRow.dedup_strategy === 'string'
        ? JSON.parse(typeRow.dedup_strategy)
        : typeRow.dedup_strategy;

    // 3. Resolve recipients
    const resolverDeps: RecipientResolverDeps = { query: this.db.query };
    const recipients = await recipientResolver(event, targetRoles, resolverDeps);

    // 4. Insert notifications for each recipient
    let created = 0;
    let deduplicated = 0;

    for (const recipient of recipients) {
      const dedupKey = buildDedupKey(
        event.typeSlug,
        recipient.userId,
        event.entityId,
        dedupStrategy,
      );

      const { content: renderedContent } = renderTemplate(displayTemplate, event.context);
      const actionUrl = renderActionUrl(actionUrlTemplate, event.context);

      let insertedCount: number;

      if (dedupKey !== null) {
        // Use ON CONFLICT for dedup_key uniqueness
        insertedCount = await this.db.execute(
          `INSERT INTO notification (notification_type_id, recipient_user_id, state, rendered_content, action_url, dedup_key, context, created_at)
           VALUES ($1, $2, 'unread', $3, $4, $5, $6, NOW())
           ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL AND state != 'dismissed' DO NOTHING`,
          [
            notificationTypeId,
            recipient.userId,
            renderedContent,
            actionUrl,
            dedupKey,
            JSON.stringify(event.context),
          ],
        );
      } else {
        // No dedup — always insert
        insertedCount = await this.db.execute(
          `INSERT INTO notification (notification_type_id, recipient_user_id, state, rendered_content, action_url, dedup_key, context, created_at)
           VALUES ($1, $2, 'unread', $3, $4, $5, $6, NOW())`,
          [
            notificationTypeId,
            recipient.userId,
            renderedContent,
            actionUrl,
            null,
            JSON.stringify(event.context),
          ],
        );
      }

      if (insertedCount > 0) {
        created++;
      } else {
        deduplicated++;
      }
    }

    return { created, deduplicated };
  }

  async getInbox(userId: string, options: InboxOptions): Promise<PaginatedInbox> {
    // Default and clamp limit
    let limit = options.limit ?? 20;
    if (limit > 100) limit = 100;
    if (limit < 1) limit = 1;

    // Build query dynamically
    const params: unknown[] = [userId];
    let paramIdx = 2;

    let query = `SELECT n.id, nt.slug AS type_slug, nt.label AS type_label, n.rendered_content, n.state, n.created_at, n.action_url
     FROM notification n
     JOIN notification_type nt ON n.notification_type_id = nt.id
     WHERE n.recipient_user_id = $1 AND n.state != 'dismissed'`;

    if (options.stateFilter) {
      query += ` AND n.state = $${paramIdx}`;
      params.push(options.stateFilter);
      paramIdx++;
    }

    if (options.cursor) {
      const cursorTimestamp = Buffer.from(options.cursor, 'base64').toString('utf-8');
      query += ` AND n.created_at < $${paramIdx}`;
      params.push(cursorTimestamp);
      paramIdx++;
    }

    query += ` ORDER BY n.created_at DESC LIMIT $${paramIdx}`;
    params.push(limit + 1);

    const rows = await this.db.query<{
      id: string;
      type_slug: string;
      type_label: string;
      rendered_content: string;
      state: 'unread' | 'read';
      created_at: string;
      action_url: string | null;
    }>(query, params);

    // Determine if there are more results
    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    // Map to NotificationView
    const notifications: NotificationView[] = resultRows.map((row) => ({
      id: row.id,
      typeSlug: row.type_slug,
      typeLabel: row.type_label,
      renderedContent: row.rendered_content,
      state: row.state,
      createdAt: row.created_at,
      actionUrl: row.action_url,
    }));

    // Compute next cursor
    let nextCursor: string | null = null;
    if (hasMore && resultRows.length > 0) {
      const lastRow = resultRows[resultRows.length - 1];
      nextCursor = Buffer.from(lastRow.created_at).toString('base64');
    }

    // Get unread count
    const countRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notification WHERE recipient_user_id = $1 AND state = 'unread'`,
      [userId],
    );
    const unreadCount = parseInt(countRows[0]?.count ?? '0', 10);

    return { notifications, nextCursor, unreadCount };
  }

  async transitionState(
    notificationId: string,
    userId: string,
    newState: 'read' | 'dismissed',
  ): Promise<void> {
    // 1. Fetch current state
    const rows = await this.db.query<{ state: NotificationState }>(
      `SELECT state FROM notification WHERE id = $1 AND recipient_user_id = $2`,
      [notificationId, userId],
    );

    if (rows.length === 0) {
      throw new Error(`Notification not found: ${notificationId}`);
    }

    const currentState = rows[0].state;

    // 2. Check transition validity
    const result = lifecycleStateMachine(currentState, newState);

    if (!result.success) {
      throw new Error(result.error ?? `Invalid state transition from '${currentState}' to '${newState}'`);
    }

    // 3. If already in state, no-op
    if (result.alreadyInState) {
      return;
    }

    // 4. Update state with timestamp
    if (newState === 'read') {
      await this.db.execute(
        `UPDATE notification SET state = $1, read_at = NOW() WHERE id = $2`,
        [newState, notificationId],
      );
    } else {
      // dismissed
      await this.db.execute(
        `UPDATE notification SET state = $1, dismissed_at = NOW() WHERE id = $2`,
        [newState, notificationId],
      );
    }
  }

  async bulkTransition(userId: string, action: 'markAllRead' | 'dismissAll'): Promise<number> {
    if (action === 'markAllRead') {
      return this.db.execute(
        `UPDATE notification SET state = 'read', read_at = NOW() WHERE recipient_user_id = $1 AND state = 'unread'`,
        [userId],
      );
    } else {
      // dismissAll
      return this.db.execute(
        `UPDATE notification SET state = 'dismissed', dismissed_at = NOW() WHERE recipient_user_id = $1 AND state != 'dismissed'`,
        [userId],
      );
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM notification WHERE recipient_user_id = $1 AND state = 'unread'`,
      [userId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}

export { NotificationServiceImpl };
