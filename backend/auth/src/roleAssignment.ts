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
 *   - `Admin`        — MAY assign or revoke ANY role (`User`, `Field Expert`,
 *                      `Org Owner`, `Admin`), in any scope (Requirement 5.1).
 *   - `Org Owner`    — MAY assign or revoke the `Field Expert` role (carrying
 *                      one or more Writing Types), LIMITED to Organizations they
 *                      own (Requirement 5.1). MAY NOT assign or revoke the
 *                      `Org Owner` or `Admin` role (Requirement 5.2). (Adding a
 *                      User to an Organization is modelled as an Access Grant —
 *                      see the capability matrix — not as a role assignment.)
 *   - `Field Expert` / `User` — MAY assign no roles (Requirement 5.1).
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
  /** The scope the assignment applies within (owned org for an Org Owner). */
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
  const { action, role, scope } = request;

  // Admin may assign or revoke ANY role, in any scope (Requirement 5.1).
  if (actor.roles.includes('Admin')) {
    return allow(`Admin may ${action} the '${role}' role`);
  }

  // Org Owner may assign/revoke ONLY the Field Expert role, and ONLY within an
  // Organization they own (Requirements 5.1, 5.2). Any other role — including
  // Org Owner and Admin — is denied.
  if (actor.roles.includes('Org Owner')) {
    if (
      role === 'Field Expert' &&
      scope.kind === 'organization' &&
      actor.ownedOrganizationIds.includes(scope.organizationId)
    ) {
      return allow(
        `Org Owner may ${action} the 'Field Expert' role within owned Organization '${scope.organizationId}'`,
      );
    }
  }

  // Field Expert and User hold no role-assignment authority (Requirement 5.1).
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
