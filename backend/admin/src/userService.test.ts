/**
 * Unit tests for global User directory search (REQ-ORG-02 / Requirement 29.1,
 * 29.5; Requirements 2.1, 2.2, 2.3, 2.5).
 *
 * Covers:
 *   - `searchUsers` — system-wide, TechnicalAdmin only: filtering by first
 *     name, last name, email, and role; pagination; that Users remain global
 *     (no Department-scoped filtering exists); and capability enforcement.
 *   - `searchUsersScoped` — DepartmentAdmin scoped search: returns identity
 *     fields only (no roles), gated by `user.searchScoped`.
 */
import { AuthorizationError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import { searchUsers, searchUsersScoped } from './userService';

const DEPT = 'dept-1';

function seedUsers(db: FakeDb): void {
  db.seedAppUser({ id: 'u-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' });
  db.seedAppUser({ id: 'u-2', first_name: 'Alan', last_name: 'Turing', email: 'alan@example.com' });
  db.seedAppUser({ id: 'u-3', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' });
  db.seedRoleAssignment({ id: 'ra-1', user_id: 'u-1', role: 'TechnicalAdmin', scope: null });
  db.seedRoleAssignment({ id: 'ra-2', user_id: 'u-2', role: 'DepartmentAdmin', scope: { departmentId: DEPT } });
  db.seedRoleAssignment({ id: 'ra-3', user_id: 'u-3', role: 'Student', scope: null });
}

describe('searchUsers (Requirement 29.1) — TechnicalAdmin only', () => {
  it('lists all global Users system-wide, unfiltered, paginated by default', async () => {
    const db = new FakeDb();
    seedUsers(db);

    const result = await searchUsers(techAdminContext(), {}, db);

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
    const result = await searchUsers(techAdminContext(), { firstName: 'ad' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.firstName).toBe('Ada');
  });

  it('filters by last name (case-insensitive substring)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(techAdminContext(), { lastName: 'HOPPER' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.lastName).toBe('Hopper');
  });

  it('filters by email (case-insensitive substring)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(techAdminContext(), { email: 'alan@' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.email).toBe('alan@example.com');
  });

  it('filters by role and reports each matched User\'s full role set', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(techAdminContext(), { role: 'Student' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.roles).toEqual(['Student']);
  });

  it('combines filters (AND semantics)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(
      techAdminContext(),
      { lastName: 'Turing', role: 'DepartmentAdmin' },
      db,
    );
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.email).toBe('alan@example.com');

    const noMatch = await searchUsers(
      techAdminContext(),
      { lastName: 'Turing', role: 'TechnicalAdmin' },
      db,
    );
    expect(noMatch.users).toHaveLength(0);
    expect(noMatch.total).toBe(0);
  });

  it('paginates the user list (Requirement 29.5)', async () => {
    const db = new FakeDb();
    seedUsers(db);

    const pageOne = await searchUsers(techAdminContext(), { page: 1, pageSize: 2 }, db);
    expect(pageOne.users).toHaveLength(2);
    expect(pageOne.total).toBe(3);

    const pageTwo = await searchUsers(techAdminContext(), { page: 2, pageSize: 2 }, db);
    expect(pageTwo.users).toHaveLength(1);
    expect(pageTwo.total).toBe(3);
  });

  it('returns an empty page (not an error) when no Users match (empty state)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(techAdminContext(), { firstName: 'nobody' }, db);
    expect(result.users).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('never partitions by Department — Users remain global (Requirement 29.4)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsers(techAdminContext(), {}, db);
    expect(result.total).toBe(3);
  });

  it('denies a DepartmentAdmin (user.search is TechnicalAdmin only)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(searchUsers(deptAdminContext([DEPT]), {}, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('denies a Student', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(searchUsers(studentContext(), {}, db)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('searchUsersScoped — DepartmentAdmin only', () => {
  it('lets a DeptAdmin search users (identity fields only, no roles)', async () => {
    const db = new FakeDb();
    seedUsers(db);

    const result = await searchUsersScoped(deptAdminContext([DEPT]), DEPT, {}, db);

    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    // No roles field in scoped results
    result.users.forEach((u) => {
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('email');
      expect(u).toHaveProperty('firstName');
      expect(u).toHaveProperty('lastName');
      expect(u).not.toHaveProperty('roles');
    });
  });

  it('filters by first name (case-insensitive substring)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const result = await searchUsersScoped(deptAdminContext([DEPT]), DEPT, { firstName: 'grace' }, db);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.firstName).toBe('Grace');
  });

  it('paginates results', async () => {
    const db = new FakeDb();
    seedUsers(db);
    const page1 = await searchUsersScoped(deptAdminContext([DEPT]), DEPT, { page: 1, pageSize: 2 }, db);
    expect(page1.users).toHaveLength(2);
    expect(page1.total).toBe(3);
  });

  it('denies a DeptAdmin searching for a non-administered department', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(
      searchUsersScoped(deptAdminContext([DEPT]), 'other-dept', {}, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('denies a TechnicalAdmin (user.searchScoped is DeptAdmin only)', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(
      searchUsersScoped(techAdminContext(), DEPT, {}, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('denies a Student', async () => {
    const db = new FakeDb();
    seedUsers(db);
    await expect(
      searchUsersScoped(studentContext(), DEPT, {}, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
