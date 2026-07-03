/**
 * Role assignment / revocation for global Users (REQ-ROLE-MATRIX-01 /
 * Requirement 5; REQ-ORG-02 / Requirement 29.2, 29.3).
 *
 * This is the Admin_Service's write path for `role_assignment` rows. Unlike
 * every other privileged operation in this package, the authority check here
 * is NOT the capability matrix — it is the dedicated role-assignment matrix,
 * `authorizeRoleAssignment` from `@wren/auth` (per the CRITICAL guidance in
 * tasks.md: role assignment goes through that function, not
 * `authorizeCapability`). The check runs BEFORE any database write and denies
 * with {@link AuthorizationError} and NO mutation when disallowed (Requirement
 * 5.3, Requirements 36.2/36.3).
 *
 * `scope.kind` for the JSONB `role_assignment.scope` column follows the exact
 * shapes documented in `@wren/auth` `identityMapping.ts`:
 *   - `Org Owner`    → `{organizationId: "..."}`
 *   - `Field Expert` → `{writingTypeIds: ["...", ...]}` — a Field Expert may
 *     hold several Writing Types, so assigning merges the given `writingTypeId`
 *     into the EXISTING array (never clobbering other assignments) and
 *     revoking removes only that id, deleting the row entirely once the array
 *     is empty.
 *   - `User` / `Admin` → global roles, `scope` is `NULL`.
 *
 * All persistence uses the injected parameterized {@link QueryExecutor}; no
 * value is ever interpolated into SQL (Requirement 39.2).
 */
import { authorizeRoleAssignment } from '@wren/auth';
import {
  assignRoleInputSchema,
  revokeRoleInputSchema,
  type AssignRoleInput,
  type AuthContext,
  type RevokeRoleInput,
  type Role,
} from '@wren/types';

import { AuthorizationError, NotFoundError } from './errors';
import type { QueryExecutor } from './db';

/** Raw `role_assignment` row (snake_case columns from PostgreSQL). */
interface RoleAssignmentRow {
  readonly id: string;
  readonly user_id: string;
  readonly role: Role;
  readonly scope: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Find the existing `role_assignment` row for (userId, role, organizationId-scope). */
async function findOrgScopedAssignment(
  userId: string,
  role: Role,
  organizationId: string,
  db: QueryExecutor,
): Promise<RoleAssignmentRow | null> {
  const rows = await db.query<RoleAssignmentRow>(
    `SELECT id, user_id, role, scope FROM role_assignment
     WHERE user_id = $1 AND role = $2 AND scope ->> 'organizationId' = $3`,
    [userId, role, organizationId],
  );
  return rows[0] ?? null;
}

/**
 * Find the Field Expert `role_assignment` row for `userId` whose
 * `writingTypeIds` array already contains (or, for assignment, will receive)
 * an entry — Field Expert assignments are NOT scoped by Organization in the
 * schema, so there is at most one such row per user (matching the flat,
 * cross-organization `assignedWritingTypeIds` set `@wren/auth` resolves).
 */
async function findFieldExpertAssignment(
  userId: string,
  db: QueryExecutor,
): Promise<RoleAssignmentRow | null> {
  const rows = await db.query<RoleAssignmentRow>(
    `SELECT id, user_id, role, scope FROM role_assignment
     WHERE user_id = $1 AND role = 'Field Expert'`,
    [userId],
  );
  return rows[0] ?? null;
}

function writingTypeIdsOf(row: RoleAssignmentRow | null): string[] {
  const list = asRecord(row?.scope)?.['writingTypeIds'];
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Resolve the Organization that owns `writingTypeId`, for the Org Owner
 * authority check (`Field Expert` assignment authority is scoped by the owning
 * Organization, not by the assignment's own — Organization-less — schema shape).
 */
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
 * Assign a role to a global User, per the role-assignment matrix (Requirement
 * 5.1): `Admin` may assign any role in any scope; `Org Owner` may assign only
 * `Field Expert` (carrying one or more Writing Types) within Organizations they
 * own; `Field Expert` / `User` may assign nothing. Denies with
 * {@link AuthorizationError} and NO mutation when disallowed.
 */
export async function assignRole(
  actor: AuthContext,
  input: AssignRoleInput,
  db: QueryExecutor,
): Promise<void> {
  const parsed = assignRoleInputSchema.parse(input);
  const { userId, role, scope, writingTypeId } = parsed;

  if (role === 'Field Expert') {
    if (!writingTypeId) {
      throw new AuthorizationError("'writingTypeId' is required to assign 'Field Expert'");
    }
    const organizationId = await findWritingTypeOrganizationId(writingTypeId, db);
    if (organizationId === null) {
      throw new NotFoundError(`Writing Type '${writingTypeId}' not found`);
    }

    const decision = authorizeRoleAssignment(actor, {
      action: 'assign',
      role,
      scope: { kind: 'organization', organizationId },
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

    const existing = await findFieldExpertAssignment(userId, db);
    const currentIds = writingTypeIdsOf(existing);
    const mergedIds = currentIds.includes(writingTypeId)
      ? currentIds
      : [...currentIds, writingTypeId];

    if (existing) {
      await db.query(
        `UPDATE role_assignment SET scope = $2 WHERE id = $1`,
        [existing.id, { writingTypeIds: mergedIds }],
      );
    } else {
      await db.query(
        `INSERT INTO role_assignment (user_id, role, scope, granted_by)
         VALUES ($1, 'Field Expert', $2, $3)`,
        [userId, { writingTypeIds: mergedIds }, actor.userId],
      );
    }
    return;
  }

  // Admin / Org Owner / User role assignments (Admin-only authority, Req 5.2).
  const decision = authorizeRoleAssignment(actor, { action: 'assign', role, scope });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }

  const scopeValue =
    scope.kind === 'organization' ? { organizationId: scope.organizationId } : null;

  await db.query(
    `INSERT INTO role_assignment (user_id, role, scope, granted_by) VALUES ($1, $2, $3, $4)`,
    [userId, role, scopeValue, actor.userId],
  );
}

/**
 * Revoke a role from a global User, per the role-assignment matrix
 * (Requirement 5.1, symmetric assign/revoke authority). For `Field Expert`,
 * removes only `writingTypeId` from the held set — deleting the
 * `role_assignment` row entirely once no Writing Types remain, since a Field
 * Expert may hold several assignments simultaneously.
 */
export async function revokeRole(
  actor: AuthContext,
  input: RevokeRoleInput,
  db: QueryExecutor,
): Promise<void> {
  const parsed = revokeRoleInputSchema.parse(input);
  const { userId, role, scope, writingTypeId } = parsed;

  if (role === 'Field Expert') {
    if (!writingTypeId) {
      throw new AuthorizationError("'writingTypeId' is required to revoke 'Field Expert'");
    }
    const organizationId = await findWritingTypeOrganizationId(writingTypeId, db);
    if (organizationId === null) {
      // Nothing to revoke against an unknown Writing Type; treat as a no-op
      // rather than leaking existence information via a differently-shaped error.
      return;
    }

    const decision = authorizeRoleAssignment(actor, {
      action: 'revoke',
      role,
      scope: { kind: 'organization', organizationId },
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

    const existing = await findFieldExpertAssignment(userId, db);
    if (!existing) {
      return;
    }
    const remainingIds = writingTypeIdsOf(existing).filter((id) => id !== writingTypeId);

    if (remainingIds.length === 0) {
      await db.query('DELETE FROM role_assignment WHERE id = $1', [existing.id]);
    } else {
      await db.query(
        `UPDATE role_assignment SET scope = $2 WHERE id = $1`,
        [existing.id, { writingTypeIds: remainingIds }],
      );
    }
    return;
  }

  const decision = authorizeRoleAssignment(actor, { action: 'revoke', role, scope });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }

  if (scope.kind === 'organization') {
    const existing = await findOrgScopedAssignment(userId, role, scope.organizationId, db);
    if (!existing) {
      return;
    }
    await db.query('DELETE FROM role_assignment WHERE id = $1', [existing.id]);
    return;
  }

  await db.query(
    `DELETE FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope IS NULL`,
    [userId, role],
  );
}
