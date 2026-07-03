/**
 * Unit tests for system-wide global User directory search (REQ-ORG-02 /
 * Requirement 29.1, 29.5; Requirements 2.1, 2.2, 2.3, 2.5).
 *
 * Covers filtering by first name, last name, email, and role; pagination;
 * that Users remain global (no Organization-scoped filtering exists); and
 * capability enforcement (Admin only — denies an Org Owner / Field Expert /
 * User with no data returned).
 */
import { AuthorizationError } from './errors';
import { FakeDb } from './fakeDb';
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';
import { searchUsers } from './userService';

function seedUsers(db: FakeDb): void {
  db.seedAppUser({ id: 'u-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' });
  db.seedAppUser({ id: 'u-2', first_name: 'Alan', last_name: 'Turing', email: 'alan@example.com' });
  db.seedAppUser({ id: 'u-3', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' });
  db.seedRoleAssignment({ id: 'ra-1', user_id: 'u-1', role: 'Admin', scope: null });
  db.seedRoleAssignment({ id: 'ra-2', user_id: 'u-2', role: 'Field Expert', scope: { writingTypeIds: ['wt-1'] } });
  db.seedRoleAssignment({ id: 'ra-3', user_id: 'u-3', role: 'Org Owner', scope: { organizationId: 'org-1' } });
}

describe('searchUsers (Requirement 29.1) — Admin only', () => {
  it('lists all global Users system-wide, unfiltered, paginated by default', async () => {
    const db = new FakeDb();
    seedUsers(db);

    const result = await searchUsers(adminContext(), {}, db);

    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.users.map((u) => u.email).sort()).toEqual([
      'ada@example.com',
      'alan@example.com',
      'grace@example.com',
    ]);
  });

  it('filters by first name (case-insensitive substring)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(adminContext(), { firstName: 'ad' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.firstName).toBe('Ada');
  });

  it('filters by last name (case-insensitive substring)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(adminContext(), { lastName: 'HOPPER' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.lastName).toBe('Hopper');
  });

  it('filters by email (case-insensitive substring)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(adminContext(), { email: 'alan@' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.email).toBe('alan@example.com');
  });

  it('filters by role and reports each matched User\'s full role set', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(adminContext(), { role: 'Field Expert' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.roles).toEqual(['Field Expert']);
  });

  it('combines filters (AND semantics)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(
      adminContext(),
      { lastName: 'Turing', role: 'Field Expert' },
      db,
    );
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.email).toBe('alan@example.com');

    const noMatch = await searchUsers(
      adminContext(),
      { lastName: 'Turing', role: 'Admin' },
      db,
    );
    expect(noMatch.users).toHaveLength(0);
    expect(noMatch.total).toBe(0);
  });

  it('paginates the user list (Requirement 29.5)', async () => {
    const db = new FakeDb();
    seedUsers(db);

    const pageOne = await searchUsers(adminContext(), { page: 1, pageSize: 2 }, db);
    expect(pageOne.users).toHaveLength(2);
    expect(pageOne.total).toBe(3);

    const pageTwo = await searchUsers(adminContext(), { page: 2, pageSize: 2 }, db);
    expect(pageTwo.users).toHaveLength(1);
    expect(pageTwo.total).toBe(3);
  });

  it('returns an empty page (not an error) when no Users match (empty state)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(adminContext(), { firstName: 'nobody' }, db);
    expect(result.users).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('never partitions by Organization — Users remain global (Requirement 29.4)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    // No organizationId filter exists on the input schema at all; searching
    // system-wide returns Users regardless of any Organization association.
    const result = await searchUsers(adminContext(), {}, db);
    expect(result.total).toBe(3);
  });

  it('denies an Org Owner (Requirements 2.1-2.3, 2.5) with no query performed', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(searchUsers(orgOwnerContext('org-1'), {}, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('denies a Field Expert', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(searchUsers(fieldExpertContext('wt-1'), {}, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('denies a plain User', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(searchUsers(userContext(), {}, db)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
