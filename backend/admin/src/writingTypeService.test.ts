/**
 * Unit tests for the configurable Writing Type catalog (REQ-ORG-CONFIG-01 /
 * Requirement 30.1; REQ-ADMIN-FEATURES-01 / Requirement 33.2; product decision 2).
 *
 * Covers CRUD, that Writing Types are user-configurable DATA (arbitrary new rows
 * can be added — not a fixed enumeration), OPEN/LOCKED/INHERIT access-state
 * control, and capability enforcement (a disallowed actor is denied with no
 * mutation).
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';
import {
  createWritingType,
  deleteWritingType,
  getWritingType,
  getWritingTypeDeletionImpact,
  listWritingTypes,
  setWritingTypeAccessState,
  updateWritingType,
} from './writingTypeService';

const ORG = 'org-1';

describe('createWritingType (Requirement 30.1)', () => {
  it('lets an Org Owner add a catalog record in an owned org, defaulting to INHERIT', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Allard' });

    const wt = await createWritingType(
      orgOwnerContext(ORG),
      { organizationId: ORG, name: 'Case Brief' },
      db,
    );

    expect(wt).toEqual({
      id: expect.any(String),
      organizationId: ORG,
      name: 'Case Brief',
      accessState: 'INHERIT',
      sizeLimitWords: null,
    });
  });

  it('lets an Admin add a catalog record with a size limit', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Allard' });

    const wt = await createWritingType(
      adminContext(),
      { organizationId: ORG, name: 'Memo', sizeLimitWords: 5000 },
      db,
    );
    expect(wt.sizeLimitWords).toBe(5000);
  });

  it('treats Writing Types as DATA: arbitrary new names can be added and listed', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Allard' });
    const owner = orgOwnerContext(ORG);

    // Names never seen before — proving there is no fixed domain enumeration.
    for (const name of ['Grant Proposal', 'Patent Claim', 'Screenplay Beat Sheet']) {
      await createWritingType(owner, { organizationId: ORG, name }, db);
    }

    const names = (await listWritingTypes(ORG, db)).map((w) => w.name);
    expect(names).toEqual(['Grant Proposal', 'Patent Claim', 'Screenplay Beat Sheet']);
  });

  it('denies an Org Owner of a DIFFERENT organization with no mutation', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Allard' });
    await expect(
      createWritingType(orgOwnerContext('other-org'), { organizationId: ORG, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.writingTypes.size).toBe(0);
  });

  it('denies a plain User with no mutation', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Allard' });
    await expect(
      createWritingType(userContext(), { organizationId: ORG, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('read Writing Types', () => {
  it('gets by id (null when absent) and lists per organization ordered by name', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-b', organization_id: ORG, name: 'Beta' });
    db.seedWritingType({ id: 'wt-a', organization_id: ORG, name: 'Alpha' });
    db.seedWritingType({ id: 'wt-x', organization_id: 'other', name: 'Elsewhere' });

    expect(await getWritingType('wt-a', db)).toMatchObject({ id: 'wt-a', name: 'Alpha' });
    expect(await getWritingType('missing', db)).toBeNull();

    const names = (await listWritingTypes(ORG, db)).map((w) => w.name);
    expect(names).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateWritingType', () => {
  it('lets an Org Owner rename and re-limit a catalog record in an owned org', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Allard' });
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'Old', size_limit_words: null });

    const updated = await updateWritingType(
      orgOwnerContext(ORG),
      'wt-1',
      { name: 'New', sizeLimitWords: 8000 },
      db,
    );
    expect(updated).toMatchObject({ name: 'New', sizeLimitWords: 8000, accessState: 'INHERIT' });
  });

  it('throws NotFoundError for an unknown Writing Type', async () => {
    const db = new FakeDb();
    await expect(
      updateWritingType(adminContext(), 'missing', { name: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (User) with no mutation', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'Keep' });
    await expect(
      updateWritingType(userContext(), 'wt-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.writingTypes.get('wt-1')!.name).toBe('Keep');
  });
});

describe('setWritingTypeAccessState (Requirement 28.4 / 33.2)', () => {
  it('lets an Admin set OPEN, LOCKED, and INHERIT', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T', access_state: 'INHERIT' });

    expect((await setWritingTypeAccessState(adminContext(), 'wt-1', 'OPEN', db)).accessState).toBe(
      'OPEN',
    );
    expect(
      (await setWritingTypeAccessState(adminContext(), 'wt-1', 'LOCKED', db)).accessState,
    ).toBe('LOCKED');
    expect(
      (await setWritingTypeAccessState(adminContext(), 'wt-1', 'INHERIT', db)).accessState,
    ).toBe('INHERIT');
  });

  it('denies an Org Owner (access control is Admin-only) with no mutation', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T', access_state: 'INHERIT' });
    await expect(
      setWritingTypeAccessState(orgOwnerContext(ORG), 'wt-1', 'OPEN', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.writingTypes.get('wt-1')!.access_state).toBe('INHERIT');
  });

  it('denies a Field Expert assigned to the type (not an access-control authority)', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T', access_state: 'INHERIT' });
    await expect(
      setWritingTypeAccessState(fieldExpertContext('wt-1'), 'wt-1', 'OPEN', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('throws NotFoundError for an unknown Writing Type', async () => {
    const db = new FakeDb();
    await expect(
      setWritingTypeAccessState(adminContext(), 'missing', 'OPEN', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getWritingTypeDeletionImpact (Requirement 30.5 — confirmation before removal)', () => {
  it('reports zero counts for a Writing Type with no assigned experts or documents', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T' });

    const impact = await getWritingTypeDeletionImpact(adminContext(), 'wt-1', db);
    expect(impact).toEqual({
      writingTypeId: 'wt-1',
      assignedFieldExpertCount: 0,
      documentCount: 0,
    });
  });

  it('counts assigned Field Experts (role_assignment scoped to the Writing Type) and Documents', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T' });
    db.seedRoleAssignment({
      id: 'ra-1',
      role: 'Field Expert',
      scope: { writingTypeIds: ['wt-1', 'wt-2'] },
    });
    db.seedRoleAssignment({
      id: 'ra-2',
      role: 'Field Expert',
      scope: { writingTypeIds: ['wt-1'] },
    });
    // Unrelated assignments must not be counted.
    db.seedRoleAssignment({ id: 'ra-3', role: 'Field Expert', scope: { writingTypeIds: ['wt-2'] } });
    db.seedRoleAssignment({ id: 'ra-4', role: 'Org Owner', scope: { organizationId: ORG } });
    db.seedDocument({ id: 'doc-1', writing_type_id: 'wt-1' });
    db.seedDocument({ id: 'doc-2', writing_type_id: 'wt-1' });
    db.seedDocument({ id: 'doc-3', writing_type_id: 'wt-2' });

    const impact = await getWritingTypeDeletionImpact(adminContext(), 'wt-1', db);
    expect(impact).toEqual({
      writingTypeId: 'wt-1',
      assignedFieldExpertCount: 2,
      documentCount: 2,
    });
  });

  it('throws NotFoundError for an unknown Writing Type', async () => {
    const db = new FakeDb();
    await expect(
      getWritingTypeDeletionImpact(adminContext(), 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (User) — a read-only report still enforces the capability', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T' });
    await expect(
      getWritingTypeDeletionImpact(userContext(), 'wt-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies an Org Owner of a different organization', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'T' });
    await expect(
      getWritingTypeDeletionImpact(orgOwnerContext('other-org'), 'wt-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('deleteWritingType', () => {
  it('lets an Org Owner delete a catalog record in an owned org', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'Bye' });

    expect(await deleteWritingType(orgOwnerContext(ORG), 'wt-1', db)).toBe(true);
    expect(await getWritingType('wt-1', db)).toBeNull();
  });

  it('returns false for an unknown Writing Type', async () => {
    const db = new FakeDb();
    expect(await deleteWritingType(adminContext(), 'missing', db)).toBe(false);
  });

  it('denies an Org Owner of a different org with no mutation', async () => {
    const db = new FakeDb();
    db.seedWritingType({ id: 'wt-1', organization_id: ORG, name: 'Keep' });
    await expect(
      deleteWritingType(orgOwnerContext('other-org'), 'wt-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.writingTypes.has('wt-1')).toBe(true);
  });
});
