/**
 * Property-based test for the role-assignment authority matrix
 * (REQ-ROLE-MATRIX-01 / Requirement 5).
 *
 * Tag: Feature: wren-writing-coach, Property 24: Role-assignment authority matrix
 * Validates: Requirements 5.1, 5.2, 5.3
 *
 * Property 24 asserts that {@link authorizeRoleAssignment} implements EXACTLY the
 * explicit authority matrix — there is no implicit role hierarchy (Requirement
 * 5.4). Across arbitrary actors (any role set + administered Departments) and
 * arbitrary requests (any Role, assign|revoke, any AssignmentScope):
 *
 *   1. TechnicalAdmin ⇒ allowed to assign/revoke ANY role in ANY scope (5.1).
 *   2. DepartmentAdmin (without TechnicalAdmin) ⇒ denied for ALL role
 *      assignments — V4 removes nested assignment authority (5.2).
 *   3. Student (with neither TechnicalAdmin nor qualifying authority) ⇒ denied
 *      for all role assignments (5.1).
 *   4. `assign` and `revoke` are symmetric (same authority); every denial yields
 *      `allowed: false` with an audit reason and no mutation (5.3). Authority is
 *      exactly the matrix — no implicit hierarchy.
 */
import fc from 'fast-check';

import type {
  AssignmentAction,
  AssignmentScope,
  AuthContext,
  Role,
} from '@wren/types';

import { wrenProperty } from '../../../testing/typescript/property';

import { authorizeRoleAssignment } from './roleAssignment';

const ALL_ROLES: readonly Role[] = ['Student', 'DepartmentAdmin', 'TechnicalAdmin'];
const ACTIONS: readonly AssignmentAction[] = ['assign', 'revoke'];

/**
 * A small, shared pool of Department ids so that a generated actor's
 * `administeredDepartmentIds` and a generated request's `scope.departmentId`
 * collide often — exercising BOTH administered and non-administered scopes.
 */
const DEPT_POOL: readonly string[] = ['dept-a', 'dept-b', 'dept-c', 'dept-d'];

const roleArb: fc.Arbitrary<Role> = fc.constantFrom(...ALL_ROLES);
const actionArb: fc.Arbitrary<AssignmentAction> = fc.constantFrom(...ACTIONS);
const deptIdArb: fc.Arbitrary<string> = fc.constantFrom(...DEPT_POOL);

/** Arbitrary role set (possibly empty, possibly holding several roles). */
const roleSetArb: fc.Arbitrary<Role[]> = fc.uniqueArray(roleArb, {
  minLength: 0,
  maxLength: ALL_ROLES.length,
});

/** Arbitrary set of administered Departments, drawn from the shared pool. */
const administeredDeptsArb: fc.Arbitrary<string[]> = fc.uniqueArray(deptIdArb, {
  minLength: 0,
  maxLength: DEPT_POOL.length,
});

/** Any AssignmentScope: a platform scope or a department scope from the pool. */
const scopeArb: fc.Arbitrary<AssignmentScope> = fc.oneof(
  fc.constant<AssignmentScope>({ kind: 'platform' }),
  deptIdArb.map<AssignmentScope>((departmentId) => ({
    kind: 'department',
    departmentId,
  })),
);

const actorArb: fc.Arbitrary<AuthContext> = fc
  .record({ roles: roleSetArb, administeredDepartmentIds: administeredDeptsArb })
  .map(({ roles, administeredDepartmentIds }) => ({
    userId: 'user-1',
    idpSubject: 'sub-1',
    email: 'user@example.com',
    roles,
    administeredDepartmentIds,
    grants: [],
  }));

/**
 * Independent oracle for the authority matrix, derived directly from the
 * acceptance criteria (NOT from the implementation). The action is deliberately
 * absent — authority is symmetric across assign/revoke (Requirement 5.1).
 */
function expectedAllowed(actor: AuthContext): boolean {
  // 1. TechnicalAdmin may assign/revoke ANY role in ANY scope (5.1).
  if (actor.roles.includes('TechnicalAdmin')) {
    return true;
  }
  // 2. DepartmentAdmin and Student hold no role-assignment authority in V4.
  return false;
}

describe('Property 24: Role-assignment authority matrix', () => {
  it('matches the explicit authority matrix for all actors, roles, actions, and scopes', () => {
    // Feature: wren-writing-coach, Property 24: Role-assignment authority matrix
    wrenProperty(
      { number: 24, text: 'Role-assignment authority matrix' },
      fc.property(actorArb, roleArb, actionArb, scopeArb, (actor, role, action, scope) => {
        const decision = authorizeRoleAssignment(actor, { action, role, scope });
        const expected = expectedAllowed(actor);

        // Points 1-3: the decision is EXACTLY the matrix (no implicit hierarchy, 5.4).
        expect(decision.allowed).toBe(expected);

        // Point 4: an audit reason is always present; a denial is a hard `false`
        // (deny-with-no-mutation, Requirement 5.3).
        expect(typeof decision.reason).toBe('string');
        expect(decision.reason.length).toBeGreaterThan(0);
        if (!expected) {
          expect(decision.allowed).toBe(false);
        }

        // Point 4: assign/revoke are symmetric — the counterpart action yields
        // the same authority for the same (actor, role, scope).
        const other: AssignmentAction = action === 'assign' ? 'revoke' : 'assign';
        const counterpart = authorizeRoleAssignment(actor, { action: other, role, scope });
        expect(counterpart.allowed).toBe(decision.allowed);
      }),
    );
  });
});
