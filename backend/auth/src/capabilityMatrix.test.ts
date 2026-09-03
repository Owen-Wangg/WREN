/**
 * Unit tests for the API-layer capability matrix (REQ-SEC-ROLE-01 /
 * Requirement 36; REQ-SCOPE-01 / Requirement 23).
 *
 * V4 coverage (3 roles, no implicit hierarchy — Requirement 5.4):
 *   - TechnicalAdmin: platform-level operations ONLY (usageLimit.configure,
 *     usageOverride.grant, user.search, documentType.setAccessState,
 *     analytics.view). NOT a superuser for educational content.
 *   - DepartmentAdmin: educational operations ONLY within administered
 *     Departments (documentType.readConfig, documentType.modifyConfig,
 *     documentType.manageCatalog, topic.manage, department.manage,
 *     accessGrant.create, accessGrant.revoke, usageOverride.grant,
 *     user.searchScoped, analytics.view).
 *   - `usageOverride.grant` and `analytics.view` are held by BOTH roles
 *     (Requirements 54.5, 41, 42) — the only capabilities shared by both.
 *   - Student: no privileged capability.
 *   - Every denial returns `allowed: false` (deny-with-no-mutation contract).
 */
import type {
  AuthContext,
  Capability,
  CapabilityRequest,
  OperationScope,
  Role,
} from '@wren/types';

import { authorizeCapability, isCapabilityAllowed } from './capabilityMatrix';

const ADMINISTERED_DEPT = 'dept-administered';
const OTHER_DEPT = 'dept-other';
const DOCUMENT_TYPE_ID = 'dt-1';

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

const departmentScope = (departmentId: string): OperationScope => ({
  kind: 'department',
  departmentId,
});

const documentTypeScope = (
  documentTypeId: string,
  departmentId: string,
): OperationScope => ({ kind: 'documentType', documentTypeId, departmentId });

const platformScope: OperationScope = { kind: 'platform' };

const req = (capability: Capability, scope: OperationScope): CapabilityRequest => ({
  capability,
  scope,
});

const TECHNICAL_ADMIN_CAPABILITIES: Capability[] = [
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
  'departmentVisibility.manage',
  'documentType.setAccessState',
  'documentType.manageCatalog',
  'documentType.readConfig',
  'documentType.modifyConfig',
  'department.manageAskWrenPrompt',
  'analytics.view',
];

const DEPARTMENT_ADMIN_CAPABILITIES: Capability[] = [
  'documentType.readConfig',
  'documentType.modifyConfig',
  'documentType.manageCatalog',
  'topic.manage',
  'department.manage',
  'department.manageAskWrenPrompt',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageOverride.grant',
  'user.searchScoped',
  'analytics.view',
];

/**
 * DepartmentAdmin capabilities NOT also held by TechnicalAdmin — used for the
 * "NOT a superuser" denial assertion, since `usageOverride.grant` is
 * deliberately held by both roles (Requirement 54.5) and must be excluded
 * from that check.
 */
const DEPARTMENT_ADMIN_EXCLUSIVE_CAPABILITIES: Capability[] =
  DEPARTMENT_ADMIN_CAPABILITIES.filter(
    (capability) => !TECHNICAL_ADMIN_CAPABILITIES.includes(capability),
  );

const ALL_CAPABILITIES: Capability[] = [
  ...TECHNICAL_ADMIN_CAPABILITIES,
  ...DEPARTMENT_ADMIN_CAPABILITIES.filter(
    (capability) => !TECHNICAL_ADMIN_CAPABILITIES.includes(capability),
  ),
];

describe('authorizeCapability — TechnicalAdmin (platform-level operations only)', () => {
  const admin = withRoles(['TechnicalAdmin']);

  it.each(TECHNICAL_ADMIN_CAPABILITIES)(
    'allows %s (platform-level capability)',
    (capability) => {
      expect(isCapabilityAllowed(admin, req(capability, platformScope))).toBe(true);
    },
  );

  it('allows TechnicalAdmin capabilities regardless of scope kind', () => {
    // TechnicalAdmin capabilities are not scoped to a specific department
    expect(
      isCapabilityAllowed(
        admin,
        req('documentType.setAccessState', departmentScope(OTHER_DEPT)),
      ),
    ).toBe(true);
  });

  it('DENIES DepartmentAdmin educational capabilities (NOT a superuser)', () => {
    for (const capability of DEPARTMENT_ADMIN_EXCLUSIVE_CAPABILITIES) {
      expect(
        isCapabilityAllowed(admin, req(capability, platformScope)),
      ).toBe(false);
    }
  });

  it('allows documentType.readConfig with a department scope (shared dept-admin UI)', () => {
    expect(
      isCapabilityAllowed(
        admin,
        req('documentType.readConfig', departmentScope(ADMINISTERED_DEPT)),
      ),
    ).toBe(true);
  });

  it('DENIES topic.manage (educational, not platform)', () => {
    expect(
      isCapabilityAllowed(
        admin,
        req('topic.manage', departmentScope(OTHER_DEPT)),
      ),
    ).toBe(false);
  });
});

describe('authorizeCapability — DepartmentAdmin (educational ops in administered Departments)', () => {
  const deptAdmin = withRoles(['DepartmentAdmin'], {
    administeredDepartmentIds: [ADMINISTERED_DEPT],
  });

  it.each(DEPARTMENT_ADMIN_CAPABILITIES)(
    'allows %s within an administered Department',
    (capability) => {
      expect(
        isCapabilityAllowed(deptAdmin, req(capability, departmentScope(ADMINISTERED_DEPT))),
      ).toBe(true);
    },
  );

  it('allows a documentType-scoped capability when its departmentId is administered', () => {
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req(
          'documentType.modifyConfig',
          documentTypeScope(DOCUMENT_TYPE_ID, ADMINISTERED_DEPT),
        ),
      ),
    ).toBe(true);
  });

  it('DENIES the same capability on a non-administered Department', () => {
    const decision = authorizeCapability(
      deptAdmin,
      req('documentType.modifyConfig', departmentScope(OTHER_DEPT)),
    );
    expect(decision.allowed).toBe(false);
  });

  it('DENIES when the documentType scope points to a non-administered Department', () => {
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req('documentType.readConfig', documentTypeScope(DOCUMENT_TYPE_ID, OTHER_DEPT)),
      ),
    ).toBe(false);
  });

  it('DENIES platform-scoped capabilities (DepartmentAdmin needs a department)', () => {
    expect(
      isCapabilityAllowed(deptAdmin, req('topic.manage', platformScope)),
    ).toBe(false);
  });

  it('DENIES TechnicalAdmin-only capabilities', () => {
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req('usageLimit.configure', departmentScope(ADMINISTERED_DEPT)),
      ),
    ).toBe(false);
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req('user.search', departmentScope(ADMINISTERED_DEPT)),
      ),
    ).toBe(false);
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req('departmentVisibility.manage', departmentScope(ADMINISTERED_DEPT)),
      ),
    ).toBe(false);
  });
});

describe('authorizeCapability — department management (department.manage)', () => {
  // `department.manage` (rename/removal) stays DepartmentAdmin-only — a
  // TechnicalAdmin does NOT hold it. Ask WREN prompt editing is a separate
  // capability (see below).
  it('allows a DepartmentAdmin within an administered Department', () => {
    const deptAdmin = withRoles(['DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    expect(
      isCapabilityAllowed(deptAdmin, req('department.manage', departmentScope(ADMINISTERED_DEPT))),
    ).toBe(true);
  });

  it('DENIES a DepartmentAdmin outside their administered Departments', () => {
    const deptAdmin = withRoles(['DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    expect(
      isCapabilityAllowed(deptAdmin, req('department.manage', departmentScope(OTHER_DEPT))),
    ).toBe(false);
  });

  it('DENIES a TechnicalAdmin (department.manage is not a platform capability)', () => {
    const admin = withRoles(['TechnicalAdmin']);
    expect(
      isCapabilityAllowed(admin, req('department.manage', departmentScope(ADMINISTERED_DEPT))),
    ).toBe(false);
  });

  it('DENIES a Student', () => {
    const student = withRoles(['Student']);
    expect(
      isCapabilityAllowed(student, req('department.manage', departmentScope(ADMINISTERED_DEPT))),
    ).toBe(false);
  });
});

describe('authorizeCapability — department Ask WREN prompt edit path (department.manageAskWrenPrompt)', () => {
  // The Ask WREN coaching prompt is a shared educational-content surface within
  // the Technical Admin domain: a DepartmentAdmin edits it scoped to an
  // administered Department, and a TechnicalAdmin edits it at platform scope.
  it('allows a DepartmentAdmin within an administered Department', () => {
    const deptAdmin = withRoles(['DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req('department.manageAskWrenPrompt', departmentScope(ADMINISTERED_DEPT)),
      ),
    ).toBe(true);
  });

  it('DENIES a DepartmentAdmin outside their administered Departments', () => {
    const deptAdmin = withRoles(['DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    expect(
      isCapabilityAllowed(
        deptAdmin,
        req('department.manageAskWrenPrompt', departmentScope(OTHER_DEPT)),
      ),
    ).toBe(false);
  });

  it('allows a TechnicalAdmin at platform scope', () => {
    const admin = withRoles(['TechnicalAdmin']);
    expect(
      isCapabilityAllowed(admin, req('department.manageAskWrenPrompt', platformScope)),
    ).toBe(true);
  });

  it('DENIES a Student', () => {
    const student = withRoles(['Student']);
    expect(
      isCapabilityAllowed(
        student,
        req('department.manageAskWrenPrompt', departmentScope(ADMINISTERED_DEPT)),
      ),
    ).toBe(false);
  });
});

describe('authorizeCapability — Student (Requirement 36: no privileged capability)', () => {
  const student = withRoles(['Student']);

  it.each(ALL_CAPABILITIES)('denies %s regardless of scope', (capability) => {
    expect(
      isCapabilityAllowed(student, req(capability, platformScope)),
    ).toBe(false);
    expect(
      isCapabilityAllowed(student, req(capability, departmentScope(ADMINISTERED_DEPT))),
    ).toBe(false);
  });
});

describe('authorizeCapability — multi-role actors', () => {
  it('permits when ANY held role authorizes the capability', () => {
    // Student alone can't, but DepartmentAdmin can in administered dept
    const multi = withRoles(['Student', 'DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    expect(
      isCapabilityAllowed(multi, req('accessGrant.create', departmentScope(ADMINISTERED_DEPT))),
    ).toBe(true);
  });

  it('TechnicalAdmin + DepartmentAdmin can do both platform and educational ops', () => {
    const multi = withRoles(['TechnicalAdmin', 'DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    expect(isCapabilityAllowed(multi, req('user.search', platformScope))).toBe(true);
    expect(
      isCapabilityAllowed(multi, req('topic.manage', departmentScope(ADMINISTERED_DEPT))),
    ).toBe(true);
  });

  it('still denies when no held role authorizes the capability/scope', () => {
    const multi = withRoles(['Student', 'DepartmentAdmin'], {
      administeredDepartmentIds: [ADMINISTERED_DEPT],
    });
    // DepartmentAdmin can't do usageLimit.configure
    expect(
      isCapabilityAllowed(multi, req('usageLimit.configure', platformScope)),
    ).toBe(false);
  });
});

describe('authorizeCapability — decision shape', () => {
  it('every denial includes a non-empty reason referencing REQ-SEC-ROLE-01', () => {
    const student = withRoles(['Student']);
    const decision = authorizeCapability(
      student,
      req('user.search', platformScope),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('REQ-SEC-ROLE-01');
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it('every allow includes a non-empty reason', () => {
    const admin = withRoles(['TechnicalAdmin']);
    const decision = authorizeCapability(
      admin,
      req('user.search', platformScope),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});
