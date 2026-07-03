/**
 * Unit tests for the API-layer capability matrix (REQ-SEC-ROLE-01 /
 * Requirement 36; REQ-SCOPE-01 / Requirement 23).
 *
 * Coverage:
 *   - Admin may perform every capability in any scope.
 *   - Org Owner is limited to business capabilities within OWNED Organizations;
 *     denied on non-owned orgs and on platform-only capabilities.
 *   - Field Expert may read/modify configuration ONLY for ASSIGNED Writing
 *     Types, ACROSS Organizations (cross-org scoping — Requirement 23.6), and is
 *     denied for unassigned types.
 *   - User holds no privileged capability.
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

const OWNED_ORG = 'org-owned';
const OTHER_ORG = 'org-other';
const ASSIGNED_WT = 'wt-assigned';
const UNASSIGNED_WT = 'wt-unassigned';

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

const orgScope = (organizationId: string): OperationScope => ({
  kind: 'organization',
  organizationId,
});

const writingTypeScope = (
  writingTypeId: string,
  organizationId: string,
): OperationScope => ({ kind: 'writingType', writingTypeId, organizationId });

const platformScope: OperationScope = { kind: 'platform' };

const req = (capability: Capability, scope: OperationScope): CapabilityRequest => ({
  capability,
  scope,
});

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

describe('authorizeCapability — Admin (Requirement 5.1: technical superuser)', () => {
  const admin = withRoles(['Admin']);

  it.each(ALL_CAPABILITIES)('allows %s in a platform scope', (capability) => {
    expect(isCapabilityAllowed(admin, req(capability, platformScope))).toBe(true);
  });

  it('allows a capability even for an Organization the Admin does not "own"', () => {
    const decision = authorizeCapability(
      admin,
      req('organization.manage', orgScope(OTHER_ORG)),
    );
    expect(decision.allowed).toBe(true);
  });

  it('allows configuration on any Writing Type without an assignment', () => {
    expect(
      isCapabilityAllowed(
        admin,
        req('writingType.modifyConfig', writingTypeScope(UNASSIGNED_WT, OTHER_ORG)),
      ),
    ).toBe(true);
  });
});

describe('authorizeCapability — Org Owner (Requirement 5.1: owned orgs only)', () => {
  const owner = withRoles(['Org Owner'], { ownedOrganizationIds: [OWNED_ORG] });

  it('allows managing the Writing Type catalog within an owned Organization', () => {
    expect(
      isCapabilityAllowed(owner, req('writingType.manageCatalog', orgScope(OWNED_ORG))),
    ).toBe(true);
  });

  it('allows managing business Topics within an owned Organization (Requirement 35.1)', () => {
    expect(isCapabilityAllowed(owner, req('topic.manage', orgScope(OWNED_ORG)))).toBe(true);
  });

  it('DENIES managing business Topics on a non-owned Organization (no mutation)', () => {
    expect(isCapabilityAllowed(owner, req('topic.manage', orgScope(OTHER_ORG)))).toBe(false);
  });

  it('allows creating/revoking Access Grants within an owned Organization', () => {
    expect(
      isCapabilityAllowed(owner, req('accessGrant.create', orgScope(OWNED_ORG))),
    ).toBe(true);
    expect(
      isCapabilityAllowed(owner, req('accessGrant.revoke', orgScope(OWNED_ORG))),
    ).toBe(true);
  });

  it('allows a catalog action on a Writing Type owned via its Organization', () => {
    expect(
      isCapabilityAllowed(
        owner,
        req('writingType.manageCatalog', writingTypeScope(ASSIGNED_WT, OWNED_ORG)),
      ),
    ).toBe(true);
  });

  it('DENIES the same capability on a non-owned Organization (no mutation)', () => {
    const decision = authorizeCapability(
      owner,
      req('writingType.manageCatalog', orgScope(OTHER_ORG)),
    );
    expect(decision.allowed).toBe(false);
  });

  it('DENIES Admin-only technical capabilities', () => {
    expect(
      isCapabilityAllowed(owner, req('organization.manage', orgScope(OWNED_ORG))),
    ).toBe(false);
    expect(
      isCapabilityAllowed(owner, req('organization.setAccessState', orgScope(OWNED_ORG))),
    ).toBe(false);
    expect(
      isCapabilityAllowed(owner, req('usageLimit.configure', platformScope)),
    ).toBe(false);
  });

  it('DENIES the system-wide user-search capability (Requirements 2.1, 2.5)', () => {
    expect(
      isCapabilityAllowed(owner, req('user.search', orgScope(OWNED_ORG))),
    ).toBe(false);
    expect(isCapabilityAllowed(owner, req('user.search', platformScope))).toBe(false);
  });

  it('DENIES editing a Writing Type configuration (Field-Expert territory)', () => {
    expect(
      isCapabilityAllowed(
        owner,
        req('writingType.modifyConfig', writingTypeScope(ASSIGNED_WT, OWNED_ORG)),
      ),
    ).toBe(false);
  });
});

describe('authorizeCapability — Field Expert (REQ-SCOPE-01: assigned types, cross-org)', () => {
  const expert = withRoles(['Field Expert'], {
    assignedWritingTypeIds: [ASSIGNED_WT],
  });

  it('allows reading configuration for an assigned Writing Type', () => {
    expect(
      isCapabilityAllowed(
        expert,
        req('writingType.readConfig', writingTypeScope(ASSIGNED_WT, OWNED_ORG)),
      ),
    ).toBe(true);
  });

  it('allows modifying configuration for an assigned Writing Type', () => {
    expect(
      isCapabilityAllowed(
        expert,
        req('writingType.modifyConfig', writingTypeScope(ASSIGNED_WT, OWNED_ORG)),
      ),
    ).toBe(true);
  });

  it('allows configuration REGARDLESS of the owning Organization (cross-org, Req 23.6)', () => {
    // The assigned Writing Type happens to live in an Organization the expert
    // has no ownership of and no membership in; scoping is purely by assignment.
    expect(
      isCapabilityAllowed(
        expert,
        req('writingType.modifyConfig', writingTypeScope(ASSIGNED_WT, OTHER_ORG)),
      ),
    ).toBe(true);
  });

  it('DENIES configuration for an UNASSIGNED Writing Type (Req 23.2, no mutation)', () => {
    const decision = authorizeCapability(
      expert,
      req('writingType.modifyConfig', writingTypeScope(UNASSIGNED_WT, OWNED_ORG)),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('REQ-SEC-ROLE-01');
  });

  it('DENIES a config capability presented with a non-writingType scope', () => {
    expect(
      isCapabilityAllowed(expert, req('writingType.modifyConfig', orgScope(OWNED_ORG))),
    ).toBe(false);
  });

  it('DENIES business/technical capabilities entirely', () => {
    expect(
      isCapabilityAllowed(
        expert,
        req('writingType.manageCatalog', writingTypeScope(ASSIGNED_WT, OWNED_ORG)),
      ),
    ).toBe(false);
    expect(
      isCapabilityAllowed(expert, req('accessGrant.create', orgScope(OWNED_ORG))),
    ).toBe(false);
  });

  it('allows granting a usage override on an assigned Writing Type', () => {
    expect(
      isCapabilityAllowed(
        expert,
        req('usageOverride.grant', writingTypeScope(ASSIGNED_WT, OTHER_ORG)),
      ),
    ).toBe(true);
  });
});

describe('authorizeCapability — plain User (Requirement 36: no privileged capability)', () => {
  const user = withRoles(['User'], {
    ownedOrganizationIds: [OWNED_ORG],
    assignedWritingTypeIds: [ASSIGNED_WT],
  });

  it.each(ALL_CAPABILITIES)('denies %s regardless of scope', (capability) => {
    expect(
      isCapabilityAllowed(user, req(capability, writingTypeScope(ASSIGNED_WT, OWNED_ORG))),
    ).toBe(false);
  });
});

describe('authorizeCapability — multi-role actors', () => {
  it('permits when ANY held role authorizes the capability', () => {
    // Field Expert (unassigned here) + Org Owner of the target org → allowed via Org Owner.
    const multi = withRoles(['User', 'Org Owner'], {
      ownedOrganizationIds: [OWNED_ORG],
    });
    expect(
      isCapabilityAllowed(multi, req('accessGrant.create', orgScope(OWNED_ORG))),
    ).toBe(true);
  });

  it('still denies when no held role authorizes the capability/scope', () => {
    const multi = withRoles(['User', 'Field Expert'], {
      assignedWritingTypeIds: [ASSIGNED_WT],
    });
    expect(
      isCapabilityAllowed(
        multi,
        req('writingType.manageCatalog', writingTypeScope(ASSIGNED_WT, OWNED_ORG)),
      ),
    ).toBe(false);
  });
});
