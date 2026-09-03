/**
 * API-layer capability matrix (REQ-SEC-ROLE-01 / Requirement 36; REQ-SCOPE-01 /
 * Requirement 23).
 *
 * This is the authoritative, server-side per-operation authorization check that
 * every service performs as its half of the dual enforcement described in the
 * design ("Request / Authorization Flow"): the Lambda authorizer issues a
 * coarse, cacheable allow, and each service RE-CHECKS the specific operation
 * here against the requester's {@link AuthContext}.
 *
 * The core is a PURE function — actor context + requested capability/scope →
 * {@link AuthorizationDecision}. There are no database calls, so the decision is
 * directly unit/property testable and reusable by every service. A disallowed
 * action always yields `allowed: false`; the caller returns an authorization
 * error and performs NO mutation, independent of UI state (Requirements 36.2,
 * 36.3).
 *
 * Scoping rules (no implicit role hierarchy — authority is the explicit matrix
 * only, Requirement 5.4):
 *
 *   - `TechnicalAdmin` — platform-level operations: usage-limit
 *                         configuration, temporary usage overrides (for any
 *                         Document Type, Requirement 54.5), system-wide User
 *                         search, Document Type access-state control, Document
 *                         Type catalog + config bootstrap (create types,
 *                         feedback categories, prompts), and platform-wide
 *                         aggregate analytics filterable by Document Type
 *                         (Requirement 41). Topics / access grants remain
 *                         DepartmentAdmin-scoped.
 *   - `DepartmentAdmin` — educational operations within administered
 *                          Departments: Document Type configuration, catalog
 *                          management, Topic management, Access Grants, usage
 *                          overrides, scoped User search, and aggregate
 *                          analytics (Requirement 42) — ALL limited to
 *                          Departments in `actor.administeredDepartmentIds`.
 *   - `Student`         — no privileged capability.
 */
import type {
  AuthContext,
  AuthorizationDecision,
  Capability,
  CapabilityRequest,
  OperationScope,
} from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Capability sets per role                                                     */
/* -------------------------------------------------------------------------- */

/** Capabilities a `TechnicalAdmin` may exercise (platform-level operations). */
const TECHNICAL_ADMIN_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
  'departmentVisibility.manage',
  // Shared dept-admin UI: System Admins may bootstrap Document Types and their
  // initial taxonomy/config (same screens DepartmentAdmins use).
  // Department-wide OPEN/LOCKED is TechnicalAdmin-only.
  'documentType.setAccessState',
  'documentType.manageCatalog',
  'documentType.readConfig',
  'documentType.modifyConfig',
  'analytics.view',
]);

/**
 * Capabilities a `DepartmentAdmin` may exercise within Departments they
 * administer. All checks require a scope that resolves to an administered
 * Department.
 */
const DEPARTMENT_ADMIN_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'documentType.readConfig',
  'documentType.modifyConfig',
  'documentType.manageCatalog',
  'topic.manage',
  'department.manage',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageOverride.grant',
  'user.searchScoped',
  'analytics.view',
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

function allow(reason: string): AuthorizationDecision {
  return { allowed: true, reason };
}

function deny(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

/**
 * Extract the Department ID from a scope, if the scope is department-bound.
 * A `platform` scope has no associated Department.
 */
function scopeDepartmentId(scope: OperationScope): string | undefined {
  if (scope.kind === 'platform') return undefined;
  return scope.departmentId;
}

/**
 * Whether the given Department ID is in the actor's administered Departments.
 */
function isDepartmentAdministered(
  actor: AuthContext,
  departmentId: string | undefined,
): boolean {
  return (
    departmentId !== undefined &&
    actor.administeredDepartmentIds.includes(departmentId)
  );
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether `actor` may perform `request.capability` in `request.scope`.
 *
 * An actor may hold several roles; the operation is permitted if ANY held role
 * authorizes it in the requested scope. The decision is a hard boundary —
 * `allowed: false` MUST cause the caller to abort with an authorization error
 * before any data operation (Requirement 36.3).
 */
export function authorizeCapability(
  actor: AuthContext,
  request: CapabilityRequest,
): AuthorizationDecision {
  const { capability, scope } = request;

  // TechnicalAdmin: platform-level operations only (NOT a superuser for
  // educational content).
  if (
    actor.roles.includes('TechnicalAdmin') &&
    TECHNICAL_ADMIN_CAPABILITIES.has(capability)
  ) {
    return allow(`TechnicalAdmin may perform '${capability}'`);
  }

  // DepartmentAdmin: educational operations, scoped to administered Departments.
  if (
    actor.roles.includes('DepartmentAdmin') &&
    DEPARTMENT_ADMIN_CAPABILITIES.has(capability)
  ) {
    const departmentId = scopeDepartmentId(scope);
    if (isDepartmentAdministered(actor, departmentId)) {
      return allow(
        `DepartmentAdmin may perform '${capability}' within administered Department '${departmentId}'`,
      );
    }
  }

  // Student: no privileged capability.
  return deny(
    `No held role authorizes '${capability}' in the requested scope (REQ-SEC-ROLE-01)`,
  );
}

/** Convenience predicate: `true` iff {@link authorizeCapability} allows it. */
export function isCapabilityAllowed(
  actor: AuthContext,
  request: CapabilityRequest,
): boolean {
  return authorizeCapability(actor, request).allowed;
}
