/**
 * Unit tests for role assignment/revocation for global Users
 * (REQ-ROLE-MATRIX-01 / Requirement 5; REQ-ORG-02 / Requirement 29.2, 29.3).
 *
 * Covers the role-assignment matrix from `@wren/auth`:
 *   - TechnicalAdmin may assign any role in any scope.
 *   - DepartmentAdmin CANNOT assign roles (denied).
 *   - Student CANNOT assign roles (denied).
 *
 * Roles: Student / DepartmentAdmin / TechnicalAdmin.
 * DepartmentAdmin assignment requires a departmentId and triggers joint
 * department-creation-plus-appointment when the department doesn't exist.
 */
import { AuthorizationError } from './errors';
import { FakeDb } from './fakeDb';
import { assignRole, revokeRole } from './roleAssignmentService';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT = 'dept-1';
const USER = 'user-target';

describe('assignRole — TechnicalAdmin (Requirement 5.1: any role, any scope)', () => {
  it('assigns the DepartmentAdmin role with joint department creation', async () => {
    const db = new FakeDb();
    // Department does NOT exist yet — it should be created implicitly.
    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );

    // Department was created
    expect(db.departments.has(DEPT)).toBe(true);
    expect(db.departments.get(DEPT)!.name).toBe(DEPT);

    // Role assignment was created
    const rows = [...db.roleAssignments.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      role: 'DepartmentAdmin',
      scope: { departmentId: DEPT },
    });
  });

  it('assigns DepartmentAdmin to an existing department without recreating it', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Existing Dept' });

    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );

    // Department name was not overwritten
    expect(db.departments.get(DEPT)!.name).toBe('Existing Dept');
    const rows = [...db.roleAssignments.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'DepartmentAdmin', scope: { departmentId: DEPT } });
  });

  it('assigns the Student role (global, scope NULL)', async () => {
    const db = new FakeDb();
    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'Student', scope: { kind: 'platform' } },
      db,
    );
    const rows = [...db.roleAssignments.values()];
    expect(rows[0]).toMatchObject({ user_id: USER, role: 'Student', scope: null });
  });

  it('assigns the TechnicalAdmin role (global, scope NULL)', async () => {
    const db = new FakeDb();
    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'TechnicalAdmin', scope: { kind: 'platform' } },
      db,
    );
    const rows = [...db.roleAssignments.values()];
    expect(rows[0]).toMatchObject({ user_id: USER, role: 'TechnicalAdmin', scope: null });
  });

  it('assigning DepartmentAdmin to same user+dept twice is idempotent (no duplicate)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });

    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );
    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );

    const rows = [...db.roleAssignments.values()].filter(
      (r) => r.user_id === USER && r.role === 'DepartmentAdmin',
    );
    expect(rows).toHaveLength(1);
  });

  it('records the TechnicalAdmin as granted_by', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });

    await assignRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );

    const rows = [...db.roleAssignments.values()];
    expect(rows[0]!.granted_by).toBe(techAdminContext().userId);
  });

  it('concurrent appointments to the same not-yet-existent department create exactly one department row (no race)', async () => {
    const db = new FakeDb();
    const otherUser = 'user-other';

    // Two TechnicalAdmins concurrently appoint different DepartmentAdmins to
    // the same not-yet-existent department. The atomic `ON CONFLICT DO
    // NOTHING` upsert must ensure only one department row is ever created,
    // regardless of interleaving, and both role assignments must still
    // succeed against that single department.
    await Promise.all([
      assignRole(
        techAdminContext(),
        { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
        db,
      ),
      assignRole(
        techAdminContext(),
        { userId: otherUser, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
        db,
      ),
    ]);

    // Exactly one department was created.
    expect(db.departments.size).toBe(1);
    expect(db.departments.has(DEPT)).toBe(true);

    // Both DepartmentAdmin assignments landed against that one department.
    const rows = [...db.roleAssignments.values()].filter((r) => r.role === 'DepartmentAdmin');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scope?.departmentId === DEPT)).toBe(true);
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([USER, otherUser]));
  });

  it('requires departmentId for DepartmentAdmin role', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        techAdminContext(),
        { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department' } } as any,
        db,
      ),
    ).rejects.toThrow();
  });
});

describe('assignRole — DepartmentAdmin CANNOT assign roles', () => {
  it('denies a DeptAdmin attempting to assign any role, no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });
    await expect(
      assignRole(
        deptAdminContext([DEPT]),
        { userId: USER, role: 'Student', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.size).toBe(0);
  });

  it('denies a DeptAdmin assigning DepartmentAdmin, no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });
    await expect(
      assignRole(
        deptAdminContext([DEPT]),
        { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a DeptAdmin assigning TechnicalAdmin, no mutation', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        deptAdminContext([DEPT]),
        { userId: USER, role: 'TechnicalAdmin', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('assignRole — Student CANNOT assign roles', () => {
  it('denies a Student attempting to assign a role, no mutation', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        studentContext(),
        { userId: USER, role: 'Student', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('revokeRole', () => {
  it('revokes a DepartmentAdmin assignment (TechnicalAdmin actor)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });
    db.seedRoleAssignment({
      id: 'ra-1',
      user_id: USER,
      role: 'DepartmentAdmin',
      scope: { departmentId: DEPT },
    });

    await revokeRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(false);
  });

  it('revokes a legacy DepartmentAdmin scope that used departmentIds[]', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });
    db.seedRoleAssignment({
      id: 'ra-legacy',
      user_id: USER,
      role: 'DepartmentAdmin',
      scope: { departmentIds: [DEPT] },
    });

    await revokeRole(
      techAdminContext(),
      {
        userId: USER,
        role: 'DepartmentAdmin',
        scope: { kind: 'department', departmentId: DEPT },
        departmentId: DEPT,
      },
      db,
    );

    expect(db.roleAssignments.has('ra-legacy')).toBe(false);
  });

  it('revokes a global Student assignment (TechnicalAdmin actor)', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'Student', scope: null });

    await revokeRole(
      techAdminContext(),
      { userId: USER, role: 'Student', scope: { kind: 'platform' } },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(false);
  });

  it('revokes a global TechnicalAdmin assignment (TechnicalAdmin actor)', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'TechnicalAdmin', scope: null });

    await revokeRole(
      techAdminContext(),
      { userId: USER, role: 'TechnicalAdmin', scope: { kind: 'platform' } },
      db,
    );

    expect(db.roleAssignments.has('ra-1')).toBe(false);
  });

  it('is a no-op when the DepartmentAdmin assignment does not exist', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Dept' });

    // Should not throw — just a no-op
    await revokeRole(
      techAdminContext(),
      { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT }, departmentId: DEPT },
      db,
    );

    expect(db.roleAssignments.size).toBe(0);
  });

  it('DENIES a DeptAdmin revoking any role, no mutation', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'Student', scope: null });

    await expect(
      revokeRole(
        deptAdminContext([DEPT]),
        { userId: USER, role: 'Student', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.has('ra-1')).toBe(true);
  });

  it('DENIES a Student revoking any role, no mutation', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'Student', scope: null });

    await expect(
      revokeRole(
        studentContext(),
        { userId: USER, role: 'Student', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.has('ra-1')).toBe(true);
  });
});
