/**
 * Unit tests for Organization management (REQ-ORG-GROUPING-01 / Requirement 28;
 * REQ-ADMIN-FEATURES-01 / Requirement 33.2).
 *
 * Covers CRUD, OPEN/LOCKED access-state control, the fact that an Organization
 * owns no Users, and capability enforcement (a disallowed actor is denied with
 * no mutation).
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import {
  createOrganization,
  deleteOrganization,
  getOrganization,
  listOrganizations,
  setOrganizationAccessState,
  updateOrganization,
} from './organizationService';
import { adminContext, orgOwnerContext, userContext } from './testContexts';

describe('createOrganization (Requirement 28.1 / 33.2)', () => {
  it('lets an Admin create a grouping that defaults to LOCKED and owns no Users', async () => {
    const db = new FakeDb();

    const org = await createOrganization(adminContext(), { name: 'Allard Law' }, db);

    expect(org).toEqual({ id: expect.any(String), name: 'Allard Law', accessState: 'LOCKED' });
    // The Organization row carries only grouping fields — no user/owner column.
    expect(Object.keys(db.organizations.get(org.id)!).sort()).toEqual([
      'access_state',
      'id',
      'name',
    ]);
  });

  it('lets an Admin create an OPEN Organization when requested', async () => {
    const db = new FakeDb();
    const org = await createOrganization(
      adminContext(),
      { name: 'Open Org', accessState: 'OPEN' },
      db,
    );
    expect(org.accessState).toBe('OPEN');
  });

  it('denies a non-Admin (Org Owner) and performs no mutation (Requirements 36.2, 36.3)', async () => {
    const db = new FakeDb();
    await expect(
      createOrganization(orgOwnerContext('org-1'), { name: 'Nope' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.organizations.size).toBe(0);
  });

  it('denies a plain User and performs no mutation', async () => {
    const db = new FakeDb();
    await expect(
      createOrganization(userContext(), { name: 'Nope' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('read Organizations', () => {
  it('gets an Organization by id and returns null when absent', async () => {
    const db = new FakeDb();
    const created = await createOrganization(adminContext(), { name: 'Read Me' }, db);

    expect(await getOrganization(created.id, db)).toEqual(created);
    expect(await getOrganization('missing', db)).toBeNull();
  });

  it('lists Organizations ordered by name', async () => {
    const db = new FakeDb();
    await createOrganization(adminContext(), { name: 'Beta' }, db);
    await createOrganization(adminContext(), { name: 'Alpha' }, db);

    const names = (await listOrganizations(db)).map((o) => o.name);
    expect(names).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateOrganization', () => {
  it('lets an Admin rename an Organization', async () => {
    const db = new FakeDb();
    const org = await createOrganization(adminContext(), { name: 'Old' }, db);

    const updated = await updateOrganization(adminContext(), org.id, { name: 'New' }, db);
    expect(updated.name).toBe('New');
  });

  it('throws NotFoundError when the Organization does not exist', async () => {
    const db = new FakeDb();
    await expect(
      updateOrganization(adminContext(), 'missing', { name: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a non-Admin with no mutation', async () => {
    const db = new FakeDb();
    const org = db.seedOrganization({ id: 'org-1', name: 'Seed', access_state: 'LOCKED' });
    await expect(
      updateOrganization(orgOwnerContext('org-1'), org.id, { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.organizations.get('org-1')!.name).toBe('Seed');
  });
});

describe('setOrganizationAccessState (Requirement 28.4 / 33.2)', () => {
  it('lets an Admin flip an Organization between OPEN and LOCKED', async () => {
    const db = new FakeDb();
    const org = await createOrganization(adminContext(), { name: 'Toggle' }, db);

    const opened = await setOrganizationAccessState(adminContext(), org.id, 'OPEN', db);
    expect(opened.accessState).toBe('OPEN');

    const locked = await setOrganizationAccessState(adminContext(), org.id, 'LOCKED', db);
    expect(locked.accessState).toBe('LOCKED');
  });

  it('denies an Org Owner (access control is Admin-only) with no mutation', async () => {
    const db = new FakeDb();
    const org = db.seedOrganization({ id: 'org-1', name: 'Seed', access_state: 'LOCKED' });
    await expect(
      setOrganizationAccessState(orgOwnerContext('org-1'), org.id, 'OPEN', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.organizations.get('org-1')!.access_state).toBe('LOCKED');
  });

  it('throws NotFoundError for an unknown Organization', async () => {
    const db = new FakeDb();
    await expect(
      setOrganizationAccessState(adminContext(), 'missing', 'OPEN', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('deleteOrganization', () => {
  it('lets an Admin delete an Organization and reports removal', async () => {
    const db = new FakeDb();
    const org = await createOrganization(adminContext(), { name: 'Bye' }, db);

    expect(await deleteOrganization(adminContext(), org.id, db)).toBe(true);
    expect(await getOrganization(org.id, db)).toBeNull();
    expect(await deleteOrganization(adminContext(), org.id, db)).toBe(false);
  });

  it('denies a non-Admin with no mutation', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: 'org-1', name: 'Keep' });
    await expect(
      deleteOrganization(userContext(), 'org-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.organizations.has('org-1')).toBe(true);
  });
});
