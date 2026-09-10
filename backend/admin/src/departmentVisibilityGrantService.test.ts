import {
  createDepartmentVisibilityGrant,
  listDepartmentVisibilityGrants,
  revokeDepartmentVisibilityGrant,
} from './departmentVisibilityGrantService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPARTMENT_ID = 'dept-1';
const USER_ID = 'user-1';

function seededDb(): FakeDb {
  const db = new FakeDb();
  db.seedDepartment({ id: DEPARTMENT_ID, name: 'Law' });
  db.seedAppUser({
    id: USER_ID,
    email: 'student@example.com',
    first_name: 'Student',
    last_name: 'One',
  });
  db.seedRoleAssignment({
    id: 'role-student',
    user_id: USER_ID,
    role: 'Student',
    scope: null,
  });
  return db;
}

describe('Department visibility grants', () => {
  it('lets TechnicalAdmin create an active grant idempotently', async () => {
    const db = seededDb();
    const first = await createDepartmentVisibilityGrant(
      techAdminContext(),
      DEPARTMENT_ID,
      { userId: USER_ID },
      db,
    );
    const second = await createDepartmentVisibilityGrant(
      techAdminContext(),
      DEPARTMENT_ID,
      { userId: USER_ID },
      db,
    );

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.grant.id).toBe(first.grant.id);
    expect(db.departmentVisibilityGrants.size).toBe(1);
  });

  it('denies non-TechnicalAdmins before mutation', async () => {
    for (const actor of [studentContext(), deptAdminContext([DEPARTMENT_ID])]) {
      const db = seededDb();
      await expect(
        createDepartmentVisibilityGrant(
          actor,
          DEPARTMENT_ID,
          { userId: USER_ID },
          db,
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(db.mutationCount).toBe(0);
    }
  });

  it('rejects unknown or archived Departments and unknown Users', async () => {
    const db = seededDb();
    await expect(
      createDepartmentVisibilityGrant(
        techAdminContext(),
        'missing',
        { userId: USER_ID },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createDepartmentVisibilityGrant(
        techAdminContext(),
        DEPARTMENT_ID,
        { userId: 'missing' },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists only active matching permissions with safe user summaries and pagination', async () => {
    const db = seededDb();
    db.seedAppUser({
      id: 'user-2',
      email: 'other@example.com',
      first_name: 'Other',
      last_name: 'Two',
    });
    db.seedDepartmentVisibilityGrant({
      id: 'grant-1',
      department_id: DEPARTMENT_ID,
      user_id: USER_ID,
    });
    db.seedDepartmentVisibilityGrant({
      id: 'grant-2',
      department_id: DEPARTMENT_ID,
      user_id: 'user-2',
    });
    db.seedDepartmentVisibilityGrant({
      id: 'grant-revoked',
      department_id: DEPARTMENT_ID,
      user_id: 'revoked-user',
      revoked_at: new Date(),
    });

    const result = await listDepartmentVisibilityGrants(
      techAdminContext(),
      DEPARTMENT_ID,
      db,
      { q: 'student@', limit: 10, offset: 0 },
    );
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.user).toMatchObject({
      id: USER_ID,
      email: 'student@example.com',
      roles: ['Student'],
    });

    const emptyLaterPage = await listDepartmentVisibilityGrants(
      techAdminContext(),
      DEPARTMENT_ID,
      db,
      { q: 'student@', limit: 10, offset: 10 },
    );
    expect(emptyLaterPage.items).toEqual([]);
    expect(emptyLaterPage.total).toBe(1);
  });

  it('soft-revokes idempotently, validates URL parentage, and supports re-grant', async () => {
    const db = seededDb();
    const created = await createDepartmentVisibilityGrant(
      techAdminContext(),
      DEPARTMENT_ID,
      { userId: USER_ID },
      db,
    );

    const revoked = await revokeDepartmentVisibilityGrant(
      techAdminContext(),
      DEPARTMENT_ID,
      created.grant.id,
      db,
    );
    expect(revoked.changed).toBe(true);
    expect(revoked.grant.revokedAt).toBeDefined();

    const repeated = await revokeDepartmentVisibilityGrant(
      techAdminContext(),
      DEPARTMENT_ID,
      created.grant.id,
      db,
    );
    expect(repeated.changed).toBe(false);

    await expect(
      revokeDepartmentVisibilityGrant(
        techAdminContext(),
        'other-dept',
        created.grant.id,
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const regranted = await createDepartmentVisibilityGrant(
      techAdminContext(),
      DEPARTMENT_ID,
      { userId: USER_ID },
      db,
    );
    expect(regranted.changed).toBe(true);
    expect(regranted.grant.id).not.toBe(created.grant.id);
  });
});
