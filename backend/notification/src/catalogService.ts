/**
 * NotificationTypeCatalogService implementation — CRUD operations for the
 * Notification_Type catalog (Technical Admin only).
 */
import type {
  NotificationType,
  NotificationTypeCatalogService,
  CreateNotificationTypeInput,
  UpdateNotificationTypeInput,
  TargetRole,
  DedupStrategy,
} from './types.js';
import { validateNoLeakConstraint } from './noLeakValidation.js';

/**
 * Action URLs must be site-relative paths. Reject schemes (`javascript:`,
 * `https:`, protocol-relative `//`) so a catalog entry cannot execute in the
 * recipient's session when assigned to `window.location` / the router.
 *
 * Mustache placeholders (`{{documentId}}`) are allowed so templates can
 * interpolate IDs; `{` / `}` are therefore in the character class.
 */
const ACTION_URL_TEMPLATE_RE = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/{}]*$/;

export function isSafeActionUrlTemplate(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (value.includes(':')) return false;
  return ACTION_URL_TEMPLATE_RE.test(value);
}

function assertSafeActionUrlTemplate(value: string | null | undefined): void {
  if (value == null || value === '') return;
  if (!isSafeActionUrlTemplate(value)) {
    throw new Error(
      'Invalid action URL template: must be a site-relative path starting with /',
    );
  }
}

export interface CatalogServiceDeps {
  query: <Row = Record<string, unknown>>(text: string, params: readonly unknown[]) => Promise<Row[]>;
  execute: (text: string, params: readonly unknown[]) => Promise<number>;
}

interface NotificationTypeRow {
  id: string;
  slug: string;
  label: string;
  display_template: string;
  action_url_template: string | null;
  target_roles: string | TargetRole[];
  dedup_strategy: string | DedupStrategy;
  created_at: string;
  updated_at: string;
}

function mapRowToNotificationType(row: NotificationTypeRow): NotificationType {
  const targetRoles: TargetRole[] =
    typeof row.target_roles === 'string'
      ? JSON.parse(row.target_roles)
      : row.target_roles;
  const dedupStrategy: DedupStrategy =
    typeof row.dedup_strategy === 'string'
      ? JSON.parse(row.dedup_strategy)
      : row.dedup_strategy;

  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    displayTemplate: row.display_template,
    actionUrlTemplate: row.action_url_template,
    targetRoles,
    dedupStrategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class NotificationTypeCatalogServiceImpl implements NotificationTypeCatalogService {
  private readonly db: CatalogServiceDeps;

  constructor(db: CatalogServiceDeps) {
    this.db = db;
  }

  async create(input: CreateNotificationTypeInput): Promise<NotificationType> {
    // 1. Validate no-leak constraint for Student-targeted types
    const validation = validateNoLeakConstraint(input.displayTemplate, input.targetRoles);
    if (!validation.valid) {
      throw new Error(
        `No-leak constraint violation: ${validation.violations.join(', ')}`,
      );
    }

    assertSafeActionUrlTemplate(input.actionUrlTemplate);

    // 2. Insert into notification_type
    const rows = await this.db.query<NotificationTypeRow>(
      `INSERT INTO notification_type (slug, label, display_template, action_url_template, target_roles, dedup_strategy, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [
        input.slug,
        input.label,
        input.displayTemplate,
        input.actionUrlTemplate ?? null,
        JSON.stringify(input.targetRoles),
        JSON.stringify(input.dedupStrategy),
      ],
    );

    return mapRowToNotificationType(rows[0]);
  }

  async update(id: string, input: UpdateNotificationTypeInput): Promise<NotificationType> {
    // 1. Fetch current row
    const currentRows = await this.db.query<NotificationTypeRow>(
      `SELECT * FROM notification_type WHERE id = $1`,
      [id],
    );

    if (currentRows.length === 0) {
      throw new Error(`Notification type not found: ${id}`);
    }

    const current = mapRowToNotificationType(currentRows[0]);

    // 2. Determine effective values for validation
    const effectiveTargetRoles = input.targetRoles ?? current.targetRoles;
    const effectiveDisplayTemplate = input.displayTemplate ?? current.displayTemplate;

    // Run no-leak validation if targeting Students
    if (input.targetRoles || input.displayTemplate) {
      if (effectiveTargetRoles.includes('Student')) {
        const validation = validateNoLeakConstraint(effectiveDisplayTemplate, effectiveTargetRoles);
        if (!validation.valid) {
          throw new Error(
            `No-leak constraint violation: ${validation.violations.join(', ')}`,
          );
        }
      }
    }

    // 3. Build SET clause dynamically
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.label !== undefined) {
      setClauses.push(`label = $${paramIdx}`);
      params.push(input.label);
      paramIdx++;
    }

    if (input.targetRoles !== undefined) {
      setClauses.push(`target_roles = $${paramIdx}`);
      params.push(JSON.stringify(input.targetRoles));
      paramIdx++;
    }

    if (input.displayTemplate !== undefined) {
      setClauses.push(`display_template = $${paramIdx}`);
      params.push(input.displayTemplate);
      paramIdx++;
    }

    if (input.actionUrlTemplate !== undefined) {
      assertSafeActionUrlTemplate(input.actionUrlTemplate);
      setClauses.push(`action_url_template = $${paramIdx}`);
      params.push(input.actionUrlTemplate);
      paramIdx++;
    }

    if (input.dedupStrategy !== undefined) {
      setClauses.push(`dedup_strategy = $${paramIdx}`);
      params.push(JSON.stringify(input.dedupStrategy));
      paramIdx++;
    }

    // Always update updated_at
    setClauses.push(`updated_at = NOW()`);

    // Add the WHERE clause param
    params.push(id);

    const rows = await this.db.query<NotificationTypeRow>(
      `UPDATE notification_type SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params,
    );

    if (rows.length === 0) {
      throw new Error(`Notification type not found: ${id}`);
    }

    return mapRowToNotificationType(rows[0]);
  }

  async list(): Promise<NotificationType[]> {
    const rows = await this.db.query<NotificationTypeRow>(
      `SELECT * FROM notification_type ORDER BY created_at`,
      [],
    );

    return rows.map(mapRowToNotificationType);
  }
}

export { NotificationTypeCatalogServiceImpl };
