/**
 * Unit tests for the role-assignment authority matrix (REQ-ROLE-MATRIX-01 /
 * Requirement 5).
 *
 * Coverage of the explicit matrix (no implicit hierarchy — Requirement 5.4):
 *   - Admin may assign/revoke ANY role, in any scope (5.1).
 *   - Org Owner may assign/revoke ONLY Field Expert, ONLY within owned orgs (5.1);
 *     denied for non-owned orgs, platform scope, and the Org Owner / Admin roles (5.2).
 *   - Field Expert and User may assign NO roles (5.1).
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

const OWNED_ORG = 'org-owned';
const OTHER_ORG = 'org-other';

const ALL_ROLES: Role[] = ['User', 'Field Expert', 'Org Owner', 'Admin'];
const ACTIONS: AssignmentAction[] = ['assign', 'revoke'];

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    idpSubject: 'sub-1',
    email: 'user@example.com',
    roles: [],
    ownedOrganizationIds: [],
    assignedWritingTypeIds: [],
    grants: [],
    ...overrides,
  };
}

function withRoles(roles: Role[], overrides: Partial<AuthContext> = {}): AuthContext {
  return actor({ roles, ...overrides });
}

const orgScope = (organizationId: string): AssignmentScope => ({
  kind: 'organization',
  organizationId,
});

const platformScope: AssignmentScope = { kind: 'platform' };

const request = (
  role: Role,
  scope: AssignmentScope,
  action: AssignmentAction = 'assign',
): RoleAssignmentRequest => ({ action, role, scope });

describe('authorizeRoleAssignment — Admin (Requirement 5.1)', () => {
  const admin = withRoles(['Admin']);

  for (const action of ACTIONS) {
    it.each(ALL_ROLES)(`allows Admin to ${action} the %s role (org scope)`, (role) => {
      expect(
        isRoleAssignmentAllowed(admin, request(role, orgScope(OTHER_ORG), action)),
      ).toBe(true);
    });

    it.each(ALL_ROLES)(`allows Admin to ${action} the %s role (platform scope)`, (role) => {
      expect(
        isRoleAssignmentAllowed(admin, request(role, platformScope, action)),
      ).toBe(true);
    });
  }
});

describe('authorizeRoleAssignment — Org Owner (Requirements 5.1, 5.2)', () => {
  const owner = withRoles(['Org Owner'], { ownedOrganizationIds: [OWNED_ORG] });

  it.each(ACTIONS)('allows %s of Field Expert within an OWNED Organization', (action) => {
    const decision = authorizeRoleAssignment(
      owner,
      request('Field Expert', orgScope(OWNED_ORG), action),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain(OWNED_ORG);
  });

  it('DENIES assigning Field Expert in a NON-owned Organization (no mutation)', () => {
    const decision = authorizeRoleAssignment(
      owner,
      request('Field Expert', orgScope(OTHER_ORG)),
    );
    expect(decision.allowed).toBe(false);
  });

  it('DENIES assigning Field Expert with a platform (non-organization) scope', () => {
    expect(
      isRoleAssignmentAllowed(owner, request('Field Expert', platformScope)),
    ).toBe(false);
  });

  it('DENIES assigning or revoking the Org Owner role (Requirement 5.2)', () => {
    for (const action of ACTIONS) {
      expect(
        isRoleAssignmentAllowed(owner, request('Org Owner', orgScope(OWNED_ORG), action)),
      ).toBe(false);
    }
  });

  it('DENIES assigning or revoking the Admin role (Requirement 5.2)', () => {
    for (const action of ACTIONS) {
      expect(
        isRoleAssignmentAllowed(owner, request('Admin', orgScope(OWNED_ORG), action)),
      ).toBe(false);
    }
  });

  it('DENIES assigning the User role (adding a User is an Access Grant, not a role)', () => {
    expect(
      isRoleAssignmentAllowed(owner, request('User', orgScope(OWNED_ORG))),
    ).toBe(false);
  });
});

describe('authorizeRoleAssignment — Field Expert and User assign nothing (Requirement 5.1)', () => {
  const expert = withRoles(['Field Expert'], {
    assignedWritingTypeIds: ['wt-assigned'],
    ownedOrganizationIds: [OWNED_ORG],
  });
  const user = withRoles(['User'], { ownedOrganizationIds: [OWNED_ORG] });

  it.each(ALL_ROLES)('denies a Field Expert assigning the %s role', (role) => {
    expect(
      isRoleAssignmentAllowed(expert, request(role, orgScope(OWNED_ORG))),
    ).toBe(false);
  });

  it.each(ALL_ROLES)('denies a plain User assigning the %s role', (role) => {
    const decision = authorizeRoleAssignment(user, request(role, orgScope(OWNED_ORG)));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('REQ-ROLE-MATRIX-01');
  });
});

describe('authorizeRoleAssignment — multi-role actors', () => {
  it('permits when a held role (Admin) authorizes what another (User) cannot', () => {
    const multi = withRoles(['User', 'Admin']);
    expect(
      isRoleAssignmentAllowed(multi, request('Admin', platformScope)),
    ).toBe(true);
  });

  it('permits Field Expert assignment via a held Org Owner role in an owned org', () => {
    const multi = withRoles(['Field Expert', 'Org Owner'], {
      ownedOrganizationIds: [OWNED_ORG],
    });
    expect(
      isRoleAssignmentAllowed(multi, request('Field Expert', orgScope(OWNED_ORG))),
    ).toBe(true);
  });
});
