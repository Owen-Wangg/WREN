/**
 * Unit tests for role assignment/revocation for global Users
 * (REQ-ROLE-MATRIX-01 / Requirement 5; REQ-ORG-02 / Requirement 29.2, 29.3).
 *
 * Covers the matrix reused from `@wren/auth` (Admin any role; Org Owner only
 * Field Expert within owned orgs, merging `writingTypeIds`; Field Expert/User
 * assign nothing), deny-with-no-mutation, and the merge/removal semantics for
 * the JSONB `{writingTypeIds: [...]}` scope shape.
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { assignRole, revokeRole } from './roleAssignmentService';
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const WT = 'wt-1';
const WT2 = 'wt-2';
const USER = 'user-target';

function seedWritingType(db: FakeDb, id: string, organizationId: string): void {
  db.seedOrganization({ id: organizationId, name: 'Org' });
  db.seedWritingType({ id, organization_id: organizationId, name: 'Type' });
}

describe('assignRole — Admin (Requirement 5.1: any role, any scope)', () => {
  it('assigns the Org Owner role to a User', async () => {
    const db = new FakeDb();
    await assignRole(
      adminContext(),
      { userId: USER, role: 'Org Owner', scope: { kind: 'organization', organizationId: ORG } },
      db,
    );

    const rows = [...db.roleAssignments.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      role: 'Org Owner',
      scope: { organizationId: ORG },
    });
    expect(db.mutationCount).toBe(1);
  });

  it('assigns the platform-scoped Admin role to a User', async () => {
    const db = new FakeDb();
    await assignRole(
      adminContext(),
      { userId: USER, role: 'Admin', scope: { kind: 'platform' } },
      db,
    );
    const rows = [...db.roleAssignments.values()];
    expect(rows[0]).toMatchObject({ user_id: USER, role: 'Admin', scope: null });
  });

  it('assigns Field Expert with a Writing Type, creating a new row', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);

    await assignRole(
      adminContext(),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT,
      },
      db,
    );

    const rows = [...db.roleAssignments.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      role: 'Field Expert',
      scope: { writingTypeIds: [WT] },
    });
  });
});

describe('assignRole — Org Owner (Requirements 5.1, 5.2, 29.3)', () => {
  it('assigns Field Expert with a Writing Type within an OWNED organization', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);

    await assignRole(
      orgOwnerContext(ORG),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT,
      },
      db,
    );

    const rows = [...db.roleAssignments.values()];
    expect(rows[0]).toMatchObject({ role: 'Field Expert', scope: { writingTypeIds: [WT] } });
  });

  it('MERGES a second Writing Type into the existing writingTypeIds array (Requirement 29.3)', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);
    seedWritingType(db, WT2, ORG);

    await assignRole(
      orgOwnerContext(ORG),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT,
      },
      db,
    );
    await assignRole(
      orgOwnerContext(ORG),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT2,
      },
      db,
    );

    const rows = [...db.roleAssignments.values()];
    expect(rows).toHaveLength(1); // still one row — merged, not duplicated.
    expect(rows[0]!.scope).toEqual({ writingTypeIds: [WT, WT2] });
  });

  it('assigning the SAME Writing Type twice does not duplicate it in the array', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);

    for (let i = 0; i < 2; i += 1) {
      await assignRole(
        orgOwnerContext(ORG),
        {
          userId: USER,
          role: 'Field Expert',
          scope: { kind: 'organization', organizationId: ORG },
          writingTypeId: WT,
        },
        db,
      );
    }

    const rows = [...db.roleAssignments.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toEqual({ writingTypeIds: [WT] });
  });

  it('does NOT clobber another user\'s unrelated Field Expert assignment', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);
    db.seedRoleAssignment({
      id: 'ra-existing',
      user_id: 'other-user',
      role: 'Field Expert',
      scope: { writingTypeIds: [WT] },
    });

    await assignRole(
      orgOwnerContext(ORG),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT,
      },
      db,
    );

    expect(db.roleAssignments.get('ra-existing')).toMatchObject({
      user_id: 'other-user',
      scope: { writingTypeIds: [WT] },
    });
    expect([...db.roleAssignments.values()]).toHaveLength(2);
  });

  it('DENIES assigning Field Expert for a Writing Type in a NON-owned organization, no mutation', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, OTHER_ORG);

    await expect(
      assignRole(
        orgOwnerContext(ORG),
        {
          userId: USER,
          role: 'Field Expert',
          scope: { kind: 'organization', organizationId: OTHER_ORG },
          writingTypeId: WT,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.size).toBe(0);
  });

  it('DENIES assigning the Org Owner role (Requirement 5.2), no mutation', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        orgOwnerContext(ORG),
        { userId: USER, role: 'Org Owner', scope: { kind: 'organization', organizationId: ORG } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('DENIES assigning the Admin role, no mutation', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        orgOwnerContext(ORG),
        { userId: USER, role: 'Admin', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('throws NotFoundError when the target Writing Type does not exist', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        orgOwnerContext(ORG),
        {
          userId: USER,
          role: 'Field Expert',
          scope: { kind: 'organization', organizationId: ORG },
          writingTypeId: 'missing-wt',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('assignRole — Field Expert / User assign nothing (Requirement 5.1)', () => {
  it('denies a Field Expert attempting to assign a role, no mutation', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);
    await expect(
      assignRole(
        fieldExpertContext(WT),
        {
          userId: USER,
          role: 'Field Expert',
          scope: { kind: 'organization', organizationId: ORG },
          writingTypeId: WT,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a plain User attempting to assign a role, no mutation', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);
    await expect(
      assignRole(
        userContext(),
        {
          userId: USER,
          role: 'Field Expert',
          scope: { kind: 'organization', organizationId: ORG },
          writingTypeId: WT,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('revokeRole', () => {
  it('removes ONE Writing Type from a multi-type Field Expert assignment, keeping the row', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);
    seedWritingType(db, WT2, ORG);
    db.seedRoleAssignment({
      id: 'ra-1',
      user_id: USER,
      role: 'Field Expert',
      scope: { writingTypeIds: [WT, WT2] },
    });

    await revokeRole(
      orgOwnerContext(ORG),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT,
      },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(true);
    expect(db.roleAssignments.get('ra-1')!.scope).toEqual({ writingTypeIds: [WT2] });
  });

  it('DELETES the row entirely once the last Writing Type is revoked', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);
    db.seedRoleAssignment({
      id: 'ra-1',
      user_id: USER,
      role: 'Field Expert',
      scope: { writingTypeIds: [WT] },
    });

    await revokeRole(
      adminContext(),
      {
        userId: USER,
        role: 'Field Expert',
        scope: { kind: 'organization', organizationId: ORG },
        writingTypeId: WT,
      },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(false);
  });

  it('revokes a global role assignment (Admin)', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'Admin', scope: null });

    await revokeRole(
      adminContext(),
      { userId: USER, role: 'Admin', scope: { kind: 'platform' } },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(false);
  });

  it('revokes an Org Owner assignment scoped to an Organization (Admin)', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({
      id: 'ra-1',
      user_id: USER,
      role: 'Org Owner',
      scope: { organizationId: ORG },
    });

    await revokeRole(
      adminContext(),
      { userId: USER, role: 'Org Owner', scope: { kind: 'organization', organizationId: ORG } },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(false);
  });

  it('DENIES an Org Owner revoking Field Expert in a NON-owned organization, no mutation', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, OTHER_ORG);
    db.seedRoleAssignment({
      id: 'ra-1',
      user_id: USER,
      role: 'Field Expert',
      scope: { writingTypeIds: [WT] },
    });

    await expect(
      revokeRole(
        orgOwnerContext(ORG),
        {
          userId: USER,
          role: 'Field Expert',
          scope: { kind: 'organization', organizationId: OTHER_ORG },
          writingTypeId: WT,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.has('ra-1')).toBe(true);
  });

  it('DENIES a Field Expert / User revoking any role, no mutation', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'Admin', scope: null });

    await expect(
      revokeRole(
        userContext(),
        { userId: USER, role: 'Admin', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.has('ra-1')).toBe(true);
  });
});
