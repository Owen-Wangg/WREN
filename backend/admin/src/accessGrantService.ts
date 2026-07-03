/**
 * Access Grant management (REQ-DOMAIN-ACCESS-01 / Requirement 4.4, 4.6;
 * REQ-ORG-02 / Requirement 29.2).
 *
 * An Access Grant associates a global User with a LOCKED scope (a Writing Type
 * or its Organization grouping) that authorizes submission — it never
 * transfers ownership of the User to the Organization; Users remain global
 * (Requirement 4.4 / 28.2). Creation and revocation are gated by the
 * `accessGrant.create` / `accessGrant.revoke` capabilities already defined in
 * `@wren/types`, which the `@wren/auth` capability matrix grants to an
 * `Org Owner` within Organizations they own, or to an `Admin` (Requirement 5.1).
 *
 * Approving a pending access request (Requirement 4.6) reuses
 * {@link createAccessGrant} directly — there is exactly ONE code path that
 * creates an Access Grant, not two.
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
  type GrantScope,
  type OperationScope,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `access_grant` row (snake_case columns from PostgreSQL). */
interface AccessGrantRow {
  readonly id: string;
  readonly user_id: string;
  readonly scope: unknown;
  readonly granted_by: string | null;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
}

const RETURNING = 'id, user_id, scope, granted_by, granted_at, revoked_at';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Map an `access_grant` scope JSONB value back to the shared {@link GrantScope} union. */
function toGrantScope(scope: unknown): GrantScope {
  const record = asRecord(scope);
  const writingTypeId = record?.['writingTypeId'];
  if (typeof writingTypeId === 'string' && writingTypeId.length > 0) {
    return { writingTypeId };
  }
  const organizationId = record?.['organizationId'];
  if (typeof organizationId === 'string' && organizationId.length > 0) {
    return { organizationId };
  }
  throw new Error('access_grant row carries a malformed scope');
}

function toAccessGrant(row: AccessGrantRow): AccessGrant {
  return accessGrantSchema.parse({
    id: row.id,
    userId: row.user_id,
    scope: toGrantScope(row.scope),
    grantedBy: row.granted_by,
    grantedAt: toIso(row.granted_at),
    ...(row.revoked_at ? { revokedAt: toIso(row.revoked_at) } : {}),
  });
}

/** Load a Writing Type's owning Organization id, or `null` when it is unknown. */
async function findWritingTypeOrganizationId(
  writingTypeId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ organization_id: string }>(
    'SELECT organization_id FROM writing_type WHERE id = $1',
    [writingTypeId],
  );
  return rows[0]?.organization_id ?? null;
}

/**
 * Resolve a {@link GrantScope} to the {@link OperationScope} the capability
 * matrix understands, so an `Org Owner`'s authority can be checked against the
 * Organization that OWNS the scope (directly, or via a Writing Type). Throws
 * {@link NotFoundError} when a `writingTypeId` scope names an unknown Writing
 * Type.
 */
async function resolveOperationScope(
  scope: GrantScope,
  db: QueryExecutor,
): Promise<OperationScope> {
  if ('organizationId' in scope) {
    return { kind: 'organization', organizationId: scope.organizationId };
  }
  const organizationId = await findWritingTypeOrganizationId(scope.writingTypeId, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${scope.writingTypeId}' not found`);
  }
  return { kind: 'writingType', writingTypeId: scope.writingTypeId, organizationId };
}

/**
 * Create an Access Grant associating a global User with a LOCKED scope
 * (`Org Owner` within an owned Organization, or `Admin` — Requirement 4.4).
 * This is the SOLE code path that inserts an `access_grant` row; access-request
 * approval ({@link approveAccessRequest}) calls this function rather than
 * duplicating the insert.
 */
export async function createAccessGrant(
  actor: AuthContext,
  input: CreateAccessGrantInput,
  db: QueryExecutor,
): Promise<AccessGrant> {
  const { userId, scope } = createAccessGrantInputSchema.parse(input);

  const operationScope = await resolveOperationScope(scope, db);
  requireCapability(actor, { capability: 'accessGrant.create', scope: operationScope });

  const scopeValue =
    'writingTypeId' in scope
      ? { writingTypeId: scope.writingTypeId }
      : { organizationId: scope.organizationId };

  const rows = await db.query<AccessGrantRow>(
    `INSERT INTO access_grant (user_id, scope, granted_by)
     VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [userId, scopeValue, actor.userId],
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
 * List active (non-revoked) Access Grants for a scope (`Org Owner` within an
 * owned Organization, or `Admin`) — gated by the same `accessGrant.create`
 * capability used for creation, since viewing an Organization's membership is
 * part of the same management authority (there is no separate list capability
 * in the matrix).
 */
export async function listAccessGrants(
  actor: AuthContext,
  scope: GrantScope,
  db: QueryExecutor,
): Promise<AccessGrant[]> {
  const operationScope = await resolveOperationScope(scope, db);
  requireCapability(actor, { capability: 'accessGrant.create', scope: operationScope });

  const rows =
    'writingTypeId' in scope
      ? await db.query<AccessGrantRow>(
          `SELECT ${RETURNING} FROM access_grant
           WHERE scope ->> 'writingTypeId' = $1 AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [scope.writingTypeId],
        )
      : await db.query<AccessGrantRow>(
          `SELECT ${RETURNING} FROM access_grant
           WHERE scope ->> 'organizationId' = $1 AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [scope.organizationId],
        );

  return rows.map(toAccessGrant);
}

/**
 * Revoke an Access Grant (`Org Owner` within an owned Organization, or
 * `Admin` — Requirement 4.4). Returns `true` when an active grant was revoked,
 * `false` when the grant does not exist or was already revoked (idempotent).
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

  const operationScope = await resolveOperationScope(existing.scope, db);
  requireCapability(actor, { capability: 'accessGrant.revoke', scope: operationScope });

  const rows = await db.query<{ id: string }>(
    `UPDATE access_grant SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/**
 * Approve a pending access request for a LOCKED scope (Requirement 4.6):
 * routes to an `Org Owner` of the scope's Organization (or an `Admin`) and, on
 * approval, creates an Access Grant. This function performs NO independent
 * insert — it delegates entirely to {@link createAccessGrant}, so grant
 * creation has exactly one code path regardless of whether it originated from
 * a direct grant or an approved request.
 */
export async function approveAccessRequest(
  actor: AuthContext,
  input: AccessRequestApprovalInput,
  db: QueryExecutor,
): Promise<AccessGrant> {
  const { userId, scope } = accessRequestApprovalInputSchema.parse(input);
  return createAccessGrant(actor, { userId, scope }, db);
}
