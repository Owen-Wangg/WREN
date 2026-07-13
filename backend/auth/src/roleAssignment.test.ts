/**
 * Unit tests for the role-assignment authority matrix (REQ-ROLE-MATRIX-01 /
 * Requirement 5).
 *
 * V4 coverage — explicit matrix (no implicit hierarchy — Requirement 5.4):
 *   - TechnicalAdmin may assign/revoke ANY role, in any scope (5.1).
 *   - DepartmentAdmin CANNOT assign any roles (5.2).
 *   - Student CANNOT assign any roles (5.1).
 *   - Every denial returns `allowed: false` (deny-with-no-mutation — 5.3).
 */
import type {
  AssignmentAction,
  AssignmentScope,
  AuthContext,
  Role,
} from '@wren/types';

import {
  authorizeRoleAssignment,
  isRoleAssignmentAllowed,
  type RoleAssignmentRequest,
} from './roleAssignment';

const DEPT_A = 'dept-a';
const DEPT_B = 'dept-b';

const ALL_ROLES: Role[] = ['Student', 'DepartmentAdmin', 'TechnicalAdmin'];
const ACTIONS: AssignmentAction[] = ['assign', 'revoke'];

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    idpSubject: 'sub-1',
    email: 'user@example.com',
    roles: [],
    administeredDepartmentIds: [],
    grants: [],
    ...overrides,
  };
}

function withRoles(roles: Role[], overrides: Partial<AuthContext> = {}): AuthContext {
  return actor({ roles, ...overrides });
}

const departmentScope = (departmentId: string): AssignmentScope => ({
  kind: 'department',
  departmentId,
});

const platformScope: AssignmentScope = { kind: 'platform' };

const request = (
  role: Role,
  scope: AssignmentScope,
  action: AssignmentAction = 'assign',
): RoleAssignmentRequest => ({ action, role, scope });

describe('authorizeRoleAssignment — TechnicalAdmin (Requirement 5.1)', () => {
  const admin = withRoles(['TechnicalAdmin']);

  for (const action of ACTIONS) {
    it.each(ALL_ROLES)(
      `allows TechnicalAdmin to ${action} the %s role (department scope)`,
      (role) => {
        expect(
          isRoleAssignmentAllowed(admin, request(role, departmentScope(DEPT_A), action)),
        ).toBe(true);
      },
    );

    it.each(ALL_ROLES)(
      `allows TechnicalAdmin to ${action} the %s role (platform scope)`,
      (role) => {
        expect(
          isRoleAssignmentAllowed(admin, request(role, platformScope, action)),
        ).toBe(true);
      },
    );
  }

  it('includes a reason when allowing', () => {
    const decision = authorizeRoleAssignment(
      admin,
      request('DepartmentAdmin', departmentScope(DEPT_A)),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.reason).toContain('TechnicalAdmin');
  });
});

describe('authorizeRoleAssignment — DepartmentAdmin CANNOT assign roles (Requirement 5.2)', () => {
  const deptAdmin = withRoles(['DepartmentAdmin'], {
    administeredDepartmentIds: [DEPT_A],
  });

  it.each(ALL_ROLES)('denies DepartmentAdmin assigning the %s role', (role) => {
    expect(
      isRoleAssignmentAllowed(deptAdmin, request(role, departmentScope(DEPT_A))),
    ).toBe(false);
  });

  it.each(ALL_ROLES)('denies DepartmentAdmin revoking the %s role', (role) => {
    expect(
      isRoleAssignmentAllowed(deptAdmin, request(role, departmentScope(DEPT_A), 'revoke')),
    ).toBe(false);
  });

  it('denies even for their own administered Department', () => {
    const decision = authorizeRoleAssignment(
      deptAdmin,
      request('Student', departmentScope(DEPT_A)),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('REQ-ROLE-MATRIX-01');
  });
});

describe('authorizeRoleAssignment — Student assigns nothing (Requirement 5.1)', () => {
  const student = withRoles(['Student']);

  it.each(ALL_ROLES)('denies a Student assigning the %s role', (role) => {
    const decision = authorizeRoleAssignment(student, request(role, platformScope));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('REQ-ROLE-MATRIX-01');
  });

  it.each(ALL_ROLES)('denies a Student revoking the %s role', (role) => {
    expect(
      isRoleAssignmentAllowed(student, request(role, departmentScope(DEPT_B), 'revoke')),
    ).toBe(false);
  });
});

describe('authorizeRoleAssignment — multi-role actors', () => {
  it('permits when a held TechnicalAdmin role authorizes what DepartmentAdmin cannot', () => {
    const multi = withRoles(['DepartmentAdmin', 'TechnicalAdmin'], {
      administeredDepartmentIds: [DEPT_A],
    });
    expect(
      isRoleAssignmentAllowed(multi, request('TechnicalAdmin', platformScope)),
    ).toBe(true);
  });

  it('permits when Student+TechnicalAdmin held — TechnicalAdmin authorizes', () => {
    const multi = withRoles(['Student', 'TechnicalAdmin']);
    expect(
      isRoleAssignmentAllowed(multi, request('DepartmentAdmin', departmentScope(DEPT_B))),
    ).toBe(true);
  });

  it('denies when only Student+DepartmentAdmin — neither can assign', () => {
    const multi = withRoles(['Student', 'DepartmentAdmin'], {
      administeredDepartmentIds: [DEPT_A],
    });
    expect(
      isRoleAssignmentAllowed(multi, request('Student', platformScope)),
    ).toBe(false);
  });
});

describe('authorizeRoleAssignment — decision symmetry (assign/revoke)', () => {
  it('assign and revoke are symmetric for TechnicalAdmin', () => {
    const admin = withRoles(['TechnicalAdmin']);
    for (const role of ALL_ROLES) {
      const assignDecision = authorizeRoleAssignment(admin, request(role, platformScope, 'assign'));
      const revokeDecision = authorizeRoleAssignment(admin, request(role, platformScope, 'revoke'));
      expect(assignDecision.allowed).toBe(revokeDecision.allowed);
    }
  });

  it('assign and revoke are symmetric for DepartmentAdmin (both denied)', () => {
    const deptAdmin = withRoles(['DepartmentAdmin'], {
      administeredDepartmentIds: [DEPT_A],
    });
    for (const role of ALL_ROLES) {
      const assignDecision = authorizeRoleAssignment(deptAdmin, request(role, departmentScope(DEPT_A), 'assign'));
      const revokeDecision = authorizeRoleAssignment(deptAdmin, request(role, departmentScope(DEPT_A), 'revoke'));
      expect(assignDecision.allowed).toBe(revokeDecision.allowed);
      expect(assignDecision.allowed).toBe(false);
    }
  });
});
