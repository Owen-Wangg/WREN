/**
 * Unit tests for Org-Owner-defined Content Types scoped to a Writing Type
 * (REQ-ORG-CONFIG-01 / Requirement 30.2).
 *
 * Covers CRUD, scoping to a Writing Type, and capability enforcement (a
 * disallowed actor is denied with no mutation).
 */
import {
  createContentType,
  deleteContentType,
  getContentType,
  listContentTypes,
  updateContentType,
} from './contentTypeService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';

const ORG = 'org-1';
const WT = 'wt-1';

function seedOrgAndWritingType(db: FakeDb): void {
  db.seedOrganization({ id: ORG, name: 'Allard' });
  db.seedWritingType({ id: WT, organization_id: ORG, name: 'Legal Writing' });
}

describe('createContentType (Requirement 30.2)', () => {
  it('lets an Org Owner define a Content Type in an owned org', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);

    const ct = await createContentType(
      orgOwnerContext(ORG),
      { writingTypeId: WT, label: 'Case Brief' },
      db,
    );

    expect(ct).toEqual({ id: expect.any(String), writingTypeId: WT, label: 'Case Brief' });
  });

  it('lets an Admin define a Content Type', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    const ct = await createContentType(adminContext(), { writingTypeId: WT, label: 'Memo' }, db);
    expect(ct.label).toBe('Memo');
  });

  it('throws NotFoundError for an unknown Writing Type', async () => {
    const db = new FakeDb();
    await expect(
      createContentType(adminContext(), { writingTypeId: 'missing', label: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an Org Owner of a DIFFERENT organization with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(
      createContentType(orgOwnerContext('other-org'), { writingTypeId: WT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.size).toBe(0);
  });

  it('denies a plain User with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(
      createContentType(userContext(), { writingTypeId: WT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Field Expert (not a catalog-management authority) with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(
      createContentType(fieldExpertContext(WT), { writingTypeId: WT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('read Content Types', () => {
  it('gets by id (null when absent) and lists per Writing Type ordered by label', async () => {
    const db = new FakeDb();
    db.seedContentType({ id: 'ct-b', writing_type_id: WT, label: 'Beta' });
    db.seedContentType({ id: 'ct-a', writing_type_id: WT, label: 'Alpha' });
    db.seedContentType({ id: 'ct-x', writing_type_id: 'other-wt', label: 'Elsewhere' });

    expect(await getContentType('ct-a', db)).toMatchObject({ id: 'ct-a', label: 'Alpha' });
    expect(await getContentType('missing', db)).toBeNull();

    const labels = (await listContentTypes(WT, db)).map((c) => c.label);
    expect(labels).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateContentType', () => {
  it('lets an Org Owner relabel a Content Type in an owned org', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedContentType({ id: 'ct-1', writing_type_id: WT, label: 'Old' });

    const updated = await updateContentType(orgOwnerContext(ORG), 'ct-1', { label: 'New' }, db);
    expect(updated).toMatchObject({ label: 'New' });
  });

  it('throws NotFoundError for an unknown Content Type', async () => {
    const db = new FakeDb();
    await expect(
      updateContentType(adminContext(), 'missing', { label: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (User) with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedContentType({ id: 'ct-1', writing_type_id: WT, label: 'Keep' });
    await expect(
      updateContentType(userContext(), 'ct-1', { label: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.get('ct-1')!.label).toBe('Keep');
  });
});

describe('deleteContentType', () => {
  it('lets an Org Owner delete a Content Type in an owned org', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedContentType({ id: 'ct-1', writing_type_id: WT, label: 'Bye' });

    expect(await deleteContentType(orgOwnerContext(ORG), 'ct-1', db)).toBe(true);
    expect(await getContentType('ct-1', db)).toBeNull();
  });

  it('returns false for an unknown Content Type', async () => {
    const db = new FakeDb();
    expect(await deleteContentType(adminContext(), 'missing', db)).toBe(false);
  });

  it('denies an Org Owner of a different org with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedContentType({ id: 'ct-1', writing_type_id: WT, label: 'Keep' });
    await expect(
      deleteContentType(orgOwnerContext('other-org'), 'ct-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.has('ct-1')).toBe(true);
  });
});
