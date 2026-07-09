/**
 * Role-assignment authority matrix (REQ-ROLE-MATRIX-01 / Requirement 5).
 *
 * Implements the design's `AuthService.authorizeRoleAssignment(actor, target,
 * role, scope)` decision as a PURE function over the actor's {@link AuthContext}.
 * There are no database calls, so it is directly unit/property testable and
 * reusable by the Admin_Service as its API-layer re-check.
 *
 * The matrix is explicit — there is NO implicit numeric "role hierarchy"
 * (Requirement 5.4). Authority is governed solely by the rules below:
 *
 *   - `TechnicalAdmin` — MAY assign or revoke ANY role (`Student`,
 *                         `DepartmentAdmin`, `TechnicalAdmin`), in any scope
 *                         (Requirement 5.1).
 *   - `DepartmentAdmin` — CANNOT assign any roles. V4 removes nested
 *                          assignment authority (Requirement 5.2).
 *   - `Student`         — CANNOT assign any roles (Requirement 5.1).
 *
 * A disallowed assignment yields `allowed: false`; the caller denies it with an
 * authorization error and performs NO assignment, independent of UI state
 * (Requirement 5.3).
 */
import type {
  AssignmentAction,
  AssignmentScope,
  AuthContext,
  AuthorizationDecision,
  Role,
} from '@wren/types';

/** A single role-assignment authority check. */
export interface RoleAssignmentRequest {
  /** Whether the actor is assigning or revoking the role (symmetric authority). */
  readonly action: AssignmentAction;
  /** The role being assigned or revoked. */
  readonly role: Role;
  /** The scope the assignment applies within. */
  readonly scope: AssignmentScope;
}

function allow(reason: string): AuthorizationDecision {
  return { allowed: true, reason };
}

function deny(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

/**
 * Decide whether `actor` may assign/revoke `request.role` in `request.scope`.
 *
 * An actor may hold several roles; the assignment is permitted if ANY held role
 * authorizes it. The decision is a hard boundary — `allowed: false` MUST cause
 * the caller to abort with an authorization error before mutating any role
 * assignment (Requirement 5.3).
 */
export function authorizeRoleAssignment(
  actor: AuthContext,
  request: RoleAssignmentRequest,
): AuthorizationDecision {
  const { action, role } = request;

  // TechnicalAdmin may assign or revoke ANY role, in any scope (Requirement 5.1).
  if (actor.roles.includes('TechnicalAdmin')) {
    return allow(`TechnicalAdmin may ${action} the '${role}' role`);
  }

  // DepartmentAdmin and Student hold no role-assignment authority in V4.
  return deny(
    `No held role authorizes ${action} of the '${role}' role in the requested scope (REQ-ROLE-MATRIX-01)`,
  );
}

/** Convenience predicate: `true` iff {@link authorizeRoleAssignment} allows it. */
export function isRoleAssignmentAllowed(
  actor: AuthContext,
  request: RoleAssignmentRequest,
): boolean {
  return authorizeRoleAssignment(actor, request).allowed;
}
