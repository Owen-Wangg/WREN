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
 * Roles: Student / DepartmentAdmin / TechnicalAdmin.
 *
 * `DepartmentAdmin` assignment requires a `departmentId`. The joint
 * department-creation-plus-appointment: when a TechnicalAdmin assigns the
 * DepartmentAdmin role to a department that doesn't exist yet, the department
 * is created as part of the same action.
 *
 * `scope.kind` for the JSONB `role_assignment.scope` column:
 *   - `DepartmentAdmin` → `{departmentId: "..."}`
 *   - `Student` / `TechnicalAdmin` → global roles, `scope` is `NULL`.
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

import { AuthorizationError } from './errors';
import type { QueryExecutor } from './db';

/** Raw `role_assignment` row (snake_case columns from PostgreSQL). */
interface RoleAssignmentRow {
  readonly id: string;
  readonly user_id: string;
  readonly role: Role;
  readonly scope: unknown;
}

/** Find the existing `role_assignment` row for (userId, role, departmentId-scope). */
async function findDeptScopedAssignment(
  userId: string,
  role: Role,
  departmentId: string,
  db: QueryExecutor,
): Promise<RoleAssignmentRow | null> {
  const rows = await db.query<RoleAssignmentRow>(
    `SELECT id, user_id, role, scope FROM role_assignment
     WHERE user_id = $1 AND role = $2 AND scope ->> 'departmentId' = $3`,
    [userId, role, departmentId],
  );
  return rows[0] ?? null;
}

/**
 * Assign a role to a global User, per the role-assignment matrix (Requirement
 * 5.1): `TechnicalAdmin` may assign any role in any scope. Denies with
 * {@link AuthorizationError} and NO mutation when disallowed.
 *
 * For `DepartmentAdmin` assignments:
 * - `departmentId` is required.
 * - If the department doesn't exist yet, it is created implicitly (joint
 *   department-creation-plus-appointment).
 */
export async function assignRole(
  actor: AuthContext,
  input: AssignRoleInput,
  db: QueryExecutor,
): Promise<void> {
  const parsed = assignRoleInputSchema.parse(input);
  const { userId, role, scope, departmentId } = parsed;

  // Authorization check via the role-assignment matrix.
  const decision = authorizeRoleAssignment(actor, { action: 'assign', role, scope });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }

  if (role === 'DepartmentAdmin') {
    if (!departmentId) {
      throw new AuthorizationError("'departmentId' is required to assign 'DepartmentAdmin'");
    }

    // Joint department-creation-plus-appointment: if the department doesn't
    // exist yet, create it implicitly.
    const existingDept = await db.query<{ id: string }>(
      'SELECT id FROM department WHERE id = $1',
      [departmentId],
    );
    if (existingDept.length === 0) {
      // Create the department with the departmentId as its name initially.
      // The DepartmentAdmin can rename it later via departmentService.
      await db.query(
        `INSERT INTO department (id, name) VALUES ($1, $2)`,
        [departmentId, departmentId],
      );
    }

    // Check for existing assignment
    const existing = await findDeptScopedAssignment(userId, role, departmentId, db);
    if (existing) {
      // Already assigned — no-op.
      return;
    }

    await db.query(
      `INSERT INTO role_assignment (user_id, role, scope, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, role, { departmentId }, actor.userId],
    );
    return;
  }

  // Student / TechnicalAdmin — global roles, scope is NULL.
  const scopeValue = null;
  await db.query(
    `INSERT INTO role_assignment (user_id, role, scope, granted_by) VALUES ($1, $2, $3, $4)`,
    [userId, role, scopeValue, actor.userId],
  );
}

/**
 * Revoke a role from a global User, per the role-assignment matrix
 * (Requirement 5.1, symmetric assign/revoke authority).
 */
export async function revokeRole(
  actor: AuthContext,
  input: RevokeRoleInput,
  db: QueryExecutor,
): Promise<void> {
  const parsed = revokeRoleInputSchema.parse(input);
  const { userId, role, scope, departmentId } = parsed;

  const decision = authorizeRoleAssignment(actor, { action: 'revoke', role, scope });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }

  if (role === 'DepartmentAdmin') {
    if (!departmentId) {
      throw new AuthorizationError("'departmentId' is required to revoke 'DepartmentAdmin'");
    }
    const existing = await findDeptScopedAssignment(userId, role, departmentId, db);
    if (!existing) {
      return;
    }
    await db.query('DELETE FROM role_assignment WHERE id = $1', [existing.id]);
    return;
  }

  // Student / TechnicalAdmin — global role, scope is NULL.
  await db.query(
    `DELETE FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope IS NULL`,
    [userId, role],
  );
}
