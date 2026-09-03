import {
  createDepartmentVisibilityGrantInputSchema,
  departmentVisibilityGrantSchema,
  departmentVisibilityPermissionListSchema,
  userSummarySchema,
  type AuthContext,
  type CreateDepartmentVisibilityGrantInput,
  type DepartmentVisibilityGrant,
  type DepartmentVisibilityPermissionList,
  type Role,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

interface VisibilityGrantRow {
  readonly id: string;
  readonly department_id: string;
  readonly user_id: string;
  readonly granted_by: string | null;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
}

interface VisibilityPermissionRow extends VisibilityGrantRow {
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly roles: Role[] | null;
  readonly administered_department_ids: string[] | null;
}

interface VisibilityPermissionCountRow {
  readonly total: string | number;
}

const RETURNING =
  'id, department_id, user_id, granted_by, granted_at, revoked_at';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toGrant(row: VisibilityGrantRow): DepartmentVisibilityGrant {
  return departmentVisibilityGrantSchema.parse({
    id: row.id,
    departmentId: row.department_id,
    userId: row.user_id,
    grantedBy: row.granted_by,
    grantedAt: toIso(row.granted_at),
    ...(row.revoked_at ? { revokedAt: toIso(row.revoked_at) } : {}),
  });
}

function requireVisibilityManager(actor: AuthContext, departmentId: string): void {
  requireCapability(actor, {
    capability: 'departmentVisibility.manage',
    scope: { kind: 'department', departmentId },
  });
}

async function assertActiveDepartment(
  departmentId: string,
  db: QueryExecutor,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM department WHERE id = $1 AND archived_at IS NULL',
    [departmentId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Department '${departmentId}' not found`);
  }
}

export interface VisibilityGrantMutationResult {
  readonly grant: DepartmentVisibilityGrant;
  readonly changed: boolean;
}

/** Create one active explicit Department visibility permission, idempotently. */
export async function createDepartmentVisibilityGrant(
  actor: AuthContext,
  departmentId: string,
  input: CreateDepartmentVisibilityGrantInput,
  db: QueryExecutor,
): Promise<VisibilityGrantMutationResult> {
  const { userId } = createDepartmentVisibilityGrantInputSchema.parse(input);
  requireVisibilityManager(actor, departmentId);
  await assertActiveDepartment(departmentId, db);

  const users = await db.query<{ id: string }>(
    'SELECT id FROM app_user WHERE id = $1',
    [userId],
  );
  if (users.length === 0) {
    throw new NotFoundError(`User '${userId}' not found`);
  }

  const inserted = await db.query<VisibilityGrantRow>(
    `INSERT INTO department_visibility_grant (department_id, user_id, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (department_id, user_id) WHERE revoked_at IS NULL DO NOTHING
     RETURNING ${RETURNING}`,
    [departmentId, userId, actor.userId],
  );
  if (inserted[0]) {
    return { grant: toGrant(inserted[0]), changed: true };
  }

  const existing = await db.query<VisibilityGrantRow>(
    `SELECT ${RETURNING}
     FROM department_visibility_grant
     WHERE department_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [departmentId, userId],
  );
  if (!existing[0]) {
    throw new Error('Active visibility grant conflict could not be resolved');
  }
  return { grant: toGrant(existing[0]), changed: false };
}

export interface VisibilityGrantListOptions {
  readonly q?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** List active explicit permissions with safe user summaries in one query. */
export async function listDepartmentVisibilityGrants(
  actor: AuthContext,
  departmentId: string,
  db: QueryExecutor,
  options: VisibilityGrantListOptions = {},
): Promise<DepartmentVisibilityPermissionList> {
  requireVisibilityManager(actor, departmentId);
  await assertActiveDepartment(departmentId, db);

  const search = options.q?.trim();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const countRows = await db.query<VisibilityPermissionCountRow>(
    `SELECT COUNT(*)::int AS total
     FROM department_visibility_grant dvg
     INNER JOIN app_user u ON u.id = dvg.user_id
     WHERE dvg.department_id = $1
       AND dvg.revoked_at IS NULL
       AND ($2::text IS NULL
         OR u.first_name ILIKE $2
         OR u.last_name ILIKE $2
         OR u.email ILIKE $2)`,
    [departmentId, search ? `%${search}%` : null],
  );
  const total = Number(countRows[0]?.total ?? 0);

  const rows = await db.query<VisibilityPermissionRow>(
    `SELECT dvg.id, dvg.department_id, dvg.user_id, dvg.granted_by,
            dvg.granted_at, dvg.revoked_at,
            u.email, u.first_name, u.last_name,
            COALESCE((
              SELECT array_agg(DISTINCT ra.role ORDER BY ra.role)
              FROM role_assignment ra
              WHERE ra.user_id = u.id
            ), ARRAY[]::text[]) AS roles,
            CASE WHEN EXISTS (
              SELECT 1 FROM role_assignment ra
              WHERE ra.user_id = u.id
                AND ra.role = 'DepartmentAdmin'
                AND (
                  ra.scope->>'departmentId' = $1::text
                  OR ra.scope->'departmentIds' ? $1::text
                )
            ) THEN ARRAY[$1::text] ELSE ARRAY[]::text[] END AS administered_department_ids
     FROM department_visibility_grant dvg
     INNER JOIN app_user u ON u.id = dvg.user_id
     WHERE dvg.department_id = $1
       AND dvg.revoked_at IS NULL
       AND ($2::text IS NULL
         OR u.first_name ILIKE $2
         OR u.last_name ILIKE $2
         OR u.email ILIKE $2)
     ORDER BY u.last_name ASC, u.first_name ASC, dvg.granted_at ASC
     LIMIT $3 OFFSET $4`,
    [departmentId, search ? `%${search}%` : null, limit, offset],
  );

  return departmentVisibilityPermissionListSchema.parse({
    items: rows.map((row) => ({
      grant: toGrant(row),
      user: userSummarySchema.parse({
        id: row.user_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        roles: row.roles ?? [],
        administeredDepartmentIds: row.administered_department_ids ?? [],
      }),
    })),
    total,
    limit,
    offset,
  });
}

/** Soft-revoke an explicit permission, idempotently and within its URL parent. */
export async function revokeDepartmentVisibilityGrant(
  actor: AuthContext,
  departmentId: string,
  grantId: string,
  db: QueryExecutor,
): Promise<VisibilityGrantMutationResult> {
  requireVisibilityManager(actor, departmentId);
  await assertActiveDepartment(departmentId, db);

  const existingRows = await db.query<VisibilityGrantRow>(
    `SELECT ${RETURNING}
     FROM department_visibility_grant
     WHERE id = $1 AND department_id = $2`,
    [grantId, departmentId],
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new NotFoundError(
      `Visibility grant '${grantId}' not found for Department '${departmentId}'`,
    );
  }
  if (existing.revoked_at) {
    return { grant: toGrant(existing), changed: false };
  }

  const updated = await db.query<VisibilityGrantRow>(
    `UPDATE department_visibility_grant
     SET revoked_at = now()
     WHERE id = $1 AND department_id = $2 AND revoked_at IS NULL
     RETURNING ${RETURNING}`,
    [grantId, departmentId],
  );
  if (!updated[0]) {
    const current = await db.query<VisibilityGrantRow>(
      `SELECT ${RETURNING}
       FROM department_visibility_grant
       WHERE id = $1 AND department_id = $2`,
      [grantId, departmentId],
    );
    if (!current[0]) {
      throw new NotFoundError(
        `Visibility grant '${grantId}' not found for Department '${departmentId}'`,
      );
    }
    return { grant: toGrant(current[0]), changed: false };
  }
  return { grant: toGrant(updated[0]), changed: true };
}
