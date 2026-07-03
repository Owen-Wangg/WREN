/**
 * Property-based test for the API-layer capability matrix
 * (REQ-SEC-ROLE-01 / Requirement 36; REQ-SCOPE-01 / Requirement 23).
 *
 * Feature: wren-writing-coach, Property 23: Capability enforcement at the API layer
 *
 * Design Property 23: For any (requester role set, requested operation, target
 * scope), the operation is permitted iff the role-capability matrix grants it
 * for that scope (including Field-Expert configuration limited to assigned
 * Writing Domains across organizations); otherwise the request is denied with
 * an authorization error and performs no data mutation, independent of any UI
 * state.
 *
 * This is verified with an INDEPENDENT reference oracle derived directly from
 * the requirements — not by re-invoking the implementation — asserting the
 * decision agrees for every generated actor / capability / scope. The oracle
 * encodes the five sub-properties:
 *
 *   1. Admin           ⇒ allowed for every capability in every scope.
 *   2. Org Owner       ⇒ allowed ONLY for the org-owner capability set AND only
 *                        when the scope's organizationId is owned; else denied.
 *   3. Field Expert    ⇒ allowed ONLY for the field-expert capability set AND
 *                        only for a writingType scope whose writingTypeId is
 *                        assigned — regardless of that type's organization
 *                        (cross-org, Req 23.6); denied for unassigned types.
 *   4. Plain User      ⇒ denied for every privileged capability.
 *   5. OR-semantics    ⇒ allowed iff ANY held role authorizes it, and every
 *                        denial yields allowed:false (deny-with-no-mutation).
 *
 * Validates: Requirements 36.1, 36.3, 36.4, 23.1, 23.2, 23.6, 4.7
 */
import fc from 'fast-check';

import { authorizeCapability, isCapabilityAllowed } from '@wren/auth';
import type {
  AuthContext,
  Capability,
  CapabilityRequest,
  OperationScope,
  Role,
} from '@wren/types';

import { wrenProperty } from '../../../testing/typescript/property';

/* -------------------------------------------------------------------------- */
/* Independent reference oracle (derived from Requirement 36 / 23, not code).  */
/* -------------------------------------------------------------------------- */

const ORG_OWNER_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'writingType.manageCatalog',
  'topic.manage',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageOverride.grant',
]);

const FIELD_EXPERT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'writingType.readConfig',
  'writingType.modifyConfig',
  'usageOverride.grant',
]);

/** Ground-truth authorization derived straight from the acceptance criteria. */
function oracleAllowed(actor: AuthContext, request: CapabilityRequest): boolean {
  const { capability, scope } = request;
  const roles = new Set<Role>(actor.roles);

  // (1) Admin: technical superuser — every capability, every scope.
  if (roles.has('Admin')) {
    return true;
  }

  // (2) Org Owner: business capabilities, scoped to OWNED Organizations only.
  if (roles.has('Org Owner') && ORG_OWNER_CAPABILITIES.has(capability)) {
    const organizationId =
      scope.kind === 'platform' ? undefined : scope.organizationId;
    if (
      organizationId !== undefined &&
      actor.ownedOrganizationIds.includes(organizationId)
    ) {
      return true;
    }
  }

  // (3) Field Expert: config/override on ASSIGNED Writing Types, cross-org.
  if (
    roles.has('Field Expert') &&
    FIELD_EXPERT_CAPABILITIES.has(capability) &&
    scope.kind === 'writingType' &&
    actor.assignedWritingTypeIds.includes(scope.writingTypeId)
  ) {
    return true;
  }

  // (4)/(5) Otherwise no held role authorizes it → deny.
  return false;
}

/* -------------------------------------------------------------------------- */
/* Smart generators — small id pools so ownership/assignment overlaps occur.   */
/* -------------------------------------------------------------------------- */

const ORG_POOL = ['org-a', 'org-b', 'org-c'] as const;
const WT_POOL = ['wt-a', 'wt-b', 'wt-c'] as const;
const ALL_ROLES: Role[] = ['User', 'Field Expert', 'Org Owner', 'Admin'];
const ALL_CAPABILITIES: Capability[] = [
  'writingType.readConfig',
  'writingType.modifyConfig',
  'writingType.manageCatalog',
  'topic.manage',
  'organization.manage',
  'organization.setAccessState',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
];

const actorArb: fc.Arbitrary<AuthContext> = fc.record({
  roles: fc.subarray(ALL_ROLES),
  ownedOrganizationIds: fc.subarray([...ORG_POOL]),
  assignedWritingTypeIds: fc.subarray([...WT_POOL]),
}).map(({ roles, ownedOrganizationIds, assignedWritingTypeIds }) => ({
  userId: 'user-1',
  idpSubject: 'sub-1',
  email: 'user@example.com',
  roles,
  ownedOrganizationIds,
  assignedWritingTypeIds,
  grants: [],
}));

const scopeArb: fc.Arbitrary<OperationScope> = fc.oneof(
  fc.constant<OperationScope>({ kind: 'platform' }),
  fc
    .constantFrom(...ORG_POOL)
    .map<OperationScope>((organizationId) => ({ kind: 'organization', organizationId })),
  fc
    .record({
      writingTypeId: fc.constantFrom(...WT_POOL),
      organizationId: fc.constantFrom(...ORG_POOL),
    })
    .map<OperationScope>(({ writingTypeId, organizationId }) => ({
      kind: 'writingType',
      writingTypeId,
      organizationId,
    })),
);

const requestArb: fc.Arbitrary<CapabilityRequest> = fc.record({
  capability: fc.constantFrom(...ALL_CAPABILITIES),
  scope: scopeArb,
});

/* -------------------------------------------------------------------------- */
/* Property                                                                    */
/* -------------------------------------------------------------------------- */

describe('Property 23: Capability enforcement at the API layer', () => {
  it('permits an operation iff the role-capability matrix grants it for the scope', () => {
    // Feature: wren-writing-coach, Property 23: Capability enforcement at the API layer
    wrenProperty(
      { number: 23, text: 'Capability enforcement at the API layer' },
      fc.property(actorArb, requestArb, (actor, request) => {
        const decision = authorizeCapability(actor, request);
        const expected = oracleAllowed(actor, request);

        // Decision matches the independent oracle across the full input space
        // (sub-properties 1-4 + OR-semantics of sub-property 5).
        expect(decision.allowed).toBe(expected);

        // Deny-with-no-mutation contract: a decision is a hard boolean and its
        // convenience predicate agrees (Requirements 36.3, 23.2).
        expect(typeof decision.allowed).toBe('boolean');
        expect(isCapabilityAllowed(actor, request)).toBe(expected);

        // Every decision carries an audit-friendly, non-empty reason
        // (Requirement 36.4), independent of any UI state.
        expect(decision.reason.length).toBeGreaterThan(0);

        // Sub-property 1 spelled out: an Admin is never denied.
        if (actor.roles.includes('Admin')) {
          expect(decision.allowed).toBe(true);
        }
      }),
    );
  });
});
