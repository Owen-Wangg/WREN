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
 *   - `Admin`        — every capability, in every scope (technical superuser).
 *   - `Org Owner`    — business management of an Organization they OWN: the
 *                      Writing Type catalog, Access Grants, and usage overrides,
 *                      limited to `ownedOrganizationIds` (Requirement 5.1).
 *   - `Field Expert` — read/modify a Writing Type's configuration, and grant
 *                      usage overrides, ONLY for Writing Types they are assigned
 *                      to — ACROSS Organizations, scoped purely by
 *                      `assignedWritingTypeIds`, never by a home Organization
 *                      (REQ-SCOPE-01 / Requirements 23.1, 23.6).
 *   - `User`         — no privileged capability.
 */
import type {
  AuthContext,
  AuthorizationDecision,
  Capability,
  CapabilityRequest,
  OperationScope,
} from '@wren/types';

/** Capabilities an `Org Owner` may exercise within Organizations they own. */
const ORG_OWNER_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'writingType.manageCatalog',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageOverride.grant',
]);

/**
 * Capabilities a `Field Expert` may exercise on Writing Types they are assigned
 * to. Configuration read/modify is the Field-Expert edit boundary; Admin owns
 * system scaffolding (REQ-PROMPT-EDIT-01) and is handled by the Admin
 * short-circuit below.
 */
const FIELD_EXPERT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'writingType.readConfig',
  'writingType.modifyConfig',
  'usageOverride.grant',
]);

function allow(reason: string): AuthorizationDecision {
  return { allowed: true, reason };
}

function deny(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

/** The Organization a scope targets, or `undefined` for a platform scope. */
function scopeOrganizationId(scope: OperationScope): string | undefined {
  return scope.kind === 'platform' ? undefined : scope.organizationId;
}

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

  // Admin: technical superuser — every capability, every scope (Requirement 5.1).
  if (actor.roles.includes('Admin')) {
    return allow(`Admin may perform '${capability}' in any scope`);
  }

  // Org Owner: business capabilities, limited to owned Organizations.
  if (actor.roles.includes('Org Owner') && ORG_OWNER_CAPABILITIES.has(capability)) {
    const organizationId = scopeOrganizationId(scope);
    if (organizationId !== undefined && actor.ownedOrganizationIds.includes(organizationId)) {
      return allow(
        `Org Owner may perform '${capability}' within owned Organization '${organizationId}'`,
      );
    }
  }

  // Field Expert: configuration + override, scoped to ASSIGNED Writing Types,
  // across Organizations (Requirement 23.6). Only a Writing-Type scope applies.
  if (
    actor.roles.includes('Field Expert') &&
    FIELD_EXPERT_CAPABILITIES.has(capability) &&
    scope.kind === 'writingType' &&
    actor.assignedWritingTypeIds.includes(scope.writingTypeId)
  ) {
    return allow(
      `Field Expert may perform '${capability}' on assigned Writing Type '${scope.writingTypeId}'`,
    );
  }

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
