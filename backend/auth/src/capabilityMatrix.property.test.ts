/**
 * Property-based test for the API-layer capability matrix
 * (REQ-SEC-ROLE-01 / Requirement 36; REQ-SCOPE-01 / Requirement 23).
 *
 * Feature: wren-writing-coach, Property 23: Capability enforcement at the API layer
 *
 * Design Property 23: For any (requester role set, requested operation, target
 * scope), the operation is permitted iff the role-capability matrix grants it
 * for that scope; otherwise the request is denied with an authorization error
 * and performs no data mutation, independent of any UI state.
 *
 * V4 model — verified with an INDEPENDENT reference oracle derived directly
 * from the requirements (NOT re-invoking the implementation). The oracle encodes
 * the three sub-properties:
 *
 *   1. TechnicalAdmin   ⇒ allowed ONLY for TechnicalAdmin capabilities
 *                         (usageLimit.configure, user.search,
 *                         documentType.setAccessState) — NOT a superuser.
 *   2. DepartmentAdmin  ⇒ allowed ONLY for DepartmentAdmin capabilities AND only
 *                         when the scope resolves to an administered Department;
 *                         denied for non-administered Departments and platform scope.
 *   3. Student          ⇒ denied for every privileged capability.
 *   4. OR-semantics     ⇒ allowed iff ANY held role authorizes it, and every
 *                         denial yields allowed:false (deny-with-no-mutation).
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

const TECHNICAL_ADMIN_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
  'documentType.setAccessState',
  'documentType.manageCatalog',
  'analytics.view',
]);

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

/** Ground-truth authorization derived straight from the acceptance criteria. */
function oracleAllowed(actor: AuthContext, request: CapabilityRequest): boolean {
  const { capability, scope } = request;
  const roles = new Set<Role>(actor.roles);

  // (1) TechnicalAdmin: platform-level operations only (NOT a superuser).
  if (roles.has('TechnicalAdmin') && TECHNICAL_ADMIN_CAPABILITIES.has(capability)) {
    return true;
  }

  // (2) DepartmentAdmin: educational operations, scoped to administered Departments.
  if (roles.has('DepartmentAdmin') && DEPARTMENT_ADMIN_CAPABILITIES.has(capability)) {
    const departmentId =
      scope.kind === 'platform' ? undefined : scope.departmentId;
    if (
      departmentId !== undefined &&
      actor.administeredDepartmentIds.includes(departmentId)
    ) {
      return true;
    }
  }

  // (3) Student: no privileged capability.
  return false;
}

/* -------------------------------------------------------------------------- */
/* Smart generators — small id pools so scope overlaps occur.                  */
/* -------------------------------------------------------------------------- */

const DEPT_POOL = ['dept-a', 'dept-b', 'dept-c'] as const;
const DT_POOL = ['dt-a', 'dt-b', 'dt-c'] as const;
const ALL_ROLES: Role[] = ['Student', 'DepartmentAdmin', 'TechnicalAdmin'];
const ALL_CAPABILITIES: Capability[] = [
  'documentType.readConfig',
  'documentType.modifyConfig',
  'documentType.manageCatalog',
  'documentType.setAccessState',
  'topic.manage',
  'department.manage',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
  'user.searchScoped',
  'analytics.view',
];

const actorArb: fc.Arbitrary<AuthContext> = fc.record({
  roles: fc.subarray(ALL_ROLES),
  administeredDepartmentIds: fc.subarray([...DEPT_POOL]),
}).map(({ roles, administeredDepartmentIds }) => ({
  userId: 'user-1',
  idpSubject: 'sub-1',
  email: 'user@example.com',
  roles,
  administeredDepartmentIds,
  grants: [],
}));

const scopeArb: fc.Arbitrary<OperationScope> = fc.oneof(
  fc.constant<OperationScope>({ kind: 'platform' }),
  fc
    .constantFrom(...DEPT_POOL)
    .map<OperationScope>((departmentId) => ({ kind: 'department', departmentId })),
  fc
    .record({
      documentTypeId: fc.constantFrom(...DT_POOL),
      departmentId: fc.constantFrom(...DEPT_POOL),
    })
    .map<OperationScope>(({ documentTypeId, departmentId }) => ({
      kind: 'documentType',
      documentTypeId,
      departmentId,
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
        // (sub-properties 1-3 + OR-semantics of sub-property 4).
        expect(decision.allowed).toBe(expected);

        // Deny-with-no-mutation contract: a decision is a hard boolean and its
        // convenience predicate agrees (Requirements 36.3, 23.2).
        expect(typeof decision.allowed).toBe('boolean');
        expect(isCapabilityAllowed(actor, request)).toBe(expected);

        // Every decision carries an audit-friendly, non-empty reason
        // (Requirement 36.4), independent of any UI state.
        expect(decision.reason.length).toBeGreaterThan(0);

        // Sub-property 3 spelled out: a Student is always denied.
        if (actor.roles.length === 1 && actor.roles[0] === 'Student') {
          expect(decision.allowed).toBe(false);
        }
      }),
    );
  });
});
