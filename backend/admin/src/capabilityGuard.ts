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
    throw new AuthorizationError(decision.reason);
  }
}
