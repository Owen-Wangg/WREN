/**
 * Access Grant management (REQ-DOMAIN-ACCESS-01 / Requirement 4.4, 4.6).
 *
 * An Access Grant associates a global User with a LOCKED Document Type that
 * authorizes submission — it never transfers ownership of the User to the
 * Department; Users remain global (Requirement 4.4 / 28.2). Creation and
 * revocation are gated by the `accessGrant.create` / `accessGrant.revoke`
 * capabilities already defined in `@wren/types`, which the `@wren/auth`
 * capability matrix grants to a `DepartmentAdmin` within administered
 * Departments (Requirement 5.1).
 *
 * Approving a pending access request (Requirement 4.6) reuses
 * {@link createAccessGrant} directly — there is exactly ONE code path that
 * creates an Access Grant, not two.
 *
 * No superuser fallback — TechnicalAdmin CANNOT perform educational operations.
 * The owning Department for the auth check is resolved from the Document Type's
 * departmentId.
 *
 * Every mutation re-checks the capability BEFORE touching the database and
 * denies with {@link AuthorizationError} and no mutation when disallowed
 * (Requirements 36.2, 36.3). All persistence uses the injected parameterized
 * {@link QueryExecutor} (Requirement 39.2).
 */
import {
  accessGrantSchema,
  accessRequestApprovalInputSchema,
  createAccessGrantInputSchema,
  type AccessGrant,
  type AccessRequestApprovalInput,
  type AuthContext,
  type CreateAccessGrantInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `access_grant` row (snake_case columns from PostgreSQL). */
interface AccessGrantRow {
  readonly id: string;
  readonly user_id: string;
  readonly document_type_id: string;
  readonly granted_by: string;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
}

const RETURNING = 'id, user_id, document_type_id, granted_by, granted_at, revoked_at';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toAccessGrant(row: AccessGrantRow): AccessGrant {
  return accessGrantSchema.parse({
    id: row.id,
    userId: row.user_id,
    documentTypeId: row.document_type_id,
    grantedBy: row.granted_by,
    grantedAt: toIso(row.granted_at),
    ...(row.revoked_at ? { revokedAt: toIso(row.revoked_at) } : {}),
  });
}

/** Load a Document Type's owning Department id, or `null` when it is unknown. */
async function findDepartmentId(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ department_id: string }>(
    'SELECT department_id FROM document_type WHERE id = $1',
    [documentTypeId],
  );
  return rows[0]?.department_id ?? null;
}

/**
 * Create an Access Grant associating a global User with a LOCKED Document Type
 * (`DepartmentAdmin` within an administered Department — Requirement 4.4).
 * This is the SOLE code path that inserts an `access_grant` row; access-request
 * approval ({@link approveAccessRequest}) calls this function rather than
 * duplicating the insert.
 */
export async function createAccessGrant(
  actor: AuthContext,
  input: CreateAccessGrantInput,
  db: QueryExecutor,
): Promise<AccessGrant> {
  const { userId, documentTypeId } = createAccessGrantInputSchema.parse(input);

  const departmentId = await findDepartmentId(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'accessGrant.create',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  const rows = await db.query<AccessGrantRow>(
    `INSERT INTO access_grant (user_id, document_type_id, granted_by)
     VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [userId, documentTypeId, actor.userId],
  );

  return toAccessGrant(rows[0]!);
}

/** Read a single Access Grant by id, or `null` when it does not exist. */
export async function getAccessGrant(
  id: string,
  db: QueryExecutor,
): Promise<AccessGrant | null> {
  const rows = await db.query<AccessGrantRow>(
    `SELECT ${RETURNING} FROM access_grant WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toAccessGrant(row) : null;
}

/**
 * List active (non-revoked) Access Grants for a Document Type
 * (`DepartmentAdmin` within an administered Department) — gated by the same
 * `accessGrant.create` capability used for creation, since viewing a Document
 * Type's membership is part of the same management authority.
 */
export async function listAccessGrants(
  actor: AuthContext,
  documentTypeId: string,
  db: QueryExecutor,
): Promise<AccessGrant[]> {
  const departmentId = await findDepartmentId(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'accessGrant.create',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  const rows = await db.query<AccessGrantRow>(
    `SELECT ${RETURNING} FROM access_grant
     WHERE document_type_id = $1 AND revoked_at IS NULL
     ORDER BY granted_at ASC`,
    [documentTypeId],
  );

  return rows.map(toAccessGrant);
}

/**
 * Revoke an Access Grant (`DepartmentAdmin` within an administered Department —
 * Requirement 4.4). Returns `true` when an active grant was revoked, `false`
 * when the grant does not exist or was already revoked (idempotent).
 */
export async function revokeAccessGrant(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const existing = await getAccessGrant(id, db);
  if (!existing) {
    return false;
  }

  const departmentId = await findDepartmentId(existing.documentTypeId, db);
  if (departmentId === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'accessGrant.revoke',
    scope: { kind: 'documentType', documentTypeId: existing.documentTypeId, departmentId },
  });

  const rows = await db.query<{ id: string }>(
    `UPDATE access_grant SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/**
 * Approve a pending access request for a LOCKED Document Type (Requirement
 * 4.6): routes to a DepartmentAdmin of the Document Type's Department and, on
 * approval, creates an Access Grant. This function performs NO independent
 * insert — it delegates entirely to {@link createAccessGrant}, so grant
 * creation has exactly one code path.
 */
export async function approveAccessRequest(
  actor: AuthContext,
  input: AccessRequestApprovalInput,
  db: QueryExecutor,
): Promise<AccessGrant> {
  const { userId, documentTypeId } = accessRequestApprovalInputSchema.parse(input);
  return createAccessGrant(actor, { userId, documentTypeId }, db);
}

/** List active (non-revoked) Access Grants for the calling user. */
export async function listMyAccessGrants(
  actor: AuthContext,
  db: QueryExecutor,
): Promise<AccessGrant[]> {
  const rows = await db.query<AccessGrantRow>(
    `SELECT ${RETURNING} FROM access_grant
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY granted_at ASC`,
    [actor.userId],
  );
  return rows.map(toAccessGrant);
}
