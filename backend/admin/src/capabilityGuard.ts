/**
 * Server-side capability guard shared by every Admin_Service operation.
 *
 * This is the Admin_Service's half of the dual authorization enforcement
 * described in the design ("Request / Authorization Flow"): the Lambda authorizer
 * issues a coarse allow, and each privileged operation RE-CHECKS the specific
 * capability here against the requester's {@link AuthContext} using the pure
 * decision function in `@wren/auth` (never a parallel auth scheme).
 *
 * A denied check throws {@link AuthorizationError} — which callers invoke BEFORE
 * touching the database — so a disallowed actor performs NO mutation, independent
 * of any UI state (Requirements 36.2, 36.3).
 */
import { authorizeCapability } from '@wren/auth';
import type { AuthContext, CapabilityRequest } from '@wren/types';

import { AuthorizationError } from './errors';

/**
 * Enforce that `actor` may perform `request`. Returns normally when allowed;
 * throws {@link AuthorizationError} with the matrix's reason when denied.
 */
export function requireCapability(
  actor: AuthContext,
  request: CapabilityRequest,
): void {
  const decision = authorizeCapability(actor, request);
  if (!decision.allowed) {
    // Log the authorization denial before throwing: previously a
    // denial threw with no log line, so 403s were invisible to operators and
    // unalarmable. Structured + machine-queryable via the stable
    // `event: "authz_denial"` key. Logs NO secrets — only the actor's app id,
    // roles, the requested capability + scope, and the matrix's reason.
    console.warn(
      JSON.stringify({
        event: 'authz_denial',
        actorUserId: actor.userId,
        roles: actor.roles,
        capability: request.capability,
        scope: request.scope,
        reason: decision.reason,
      }),
    );
    throw new AuthorizationError(decision.reason);
  }
}

/**
 * Gate for GET /v1/departments/{departmentId}/users (PII: names + emails).
 *
 * TechnicalAdmin uses platform `user.search`. Everyone else must hold
 * `user.searchScoped` for this department (DeptAdmin of that department).
 * Students are denied — they can view the department catalog, but must not
 * enumerate users across departments.
 */
export function assertCanListDepartmentUsers(
  actor: AuthContext,
  departmentId: string,
): void {
  if (actor.roles.includes('TechnicalAdmin')) {
    requireCapability(actor, { capability: 'user.search', scope: { kind: 'platform' } });
    return;
  }
  requireCapability(actor, {
    capability: 'user.searchScoped',
    scope: { kind: 'department', departmentId },
  });
}
