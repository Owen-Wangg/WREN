/**
 * Unit tests for Department management (REQ-ORG-GROUPING-01 / Requirement 28).
 *
 * Covers read/rename/delete, that a Department is a GROUPING that owns no
 * Users, and capability enforcement (a disallowed actor is denied with no
 * mutation). Departments are created implicitly via roleAssignmentService
 * (joint DepartmentAdmin appointment), but can be renamed/removed by a
 * DepartmentAdmin who administers them.
 */
import {
  archiveDepartment,
  getDepartment,
  listDepartments,
  renameDepartment,
} from './departmentService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT = 'dept-1';

describe('read Departments', () => {
  it('gets a Department by id and returns null when absent', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Allard Law' });

    const dept = await getDepartment(DEPT, db);
    expect(dept).toMatchObject({ id: DEPT, name: 'Allard Law', prompt: null });
    expect(dept?.archivedAt).toBeNull();
    expect(await getDepartment('missing', db)).toBeNull();
  });

  it('lists Departments ordered by name', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: 'dept-b', name: 'Beta' });
    db.seedDepartment({ id: 'dept-a', name: 'Alpha' });

    const names = (await listDepartments(db)).map((d) => d.name);
    expect(names).toEqual(['Alpha', 'Beta']);
  });
});

describe('renameDepartment (department.manage capability)', () => {
  it('lets a DepartmentAdmin rename an administered Department', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Old' });

    const updated = await renameDepartment(
      deptAdminContext([DEPT]),
      DEPT,
      { name: 'New' },
      db,
    );
    expect(updated.name).toBe('New');
  });

  it('throws NotFoundError when the Department does not exist', async () => {
    const db = new FakeDb();
    await expect(
      renameDepartment(deptAdminContext(['missing']), 'missing', { name: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DepartmentAdmin of a DIFFERENT department with no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Keep' });
    await expect(
      renameDepartment(deptAdminContext(['other-dept']), DEPT, { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.departments.get(DEPT)!.name).toBe('Keep');
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Keep' });
    await expect(
      renameDepartment(studentContext(), DEPT, { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a TechnicalAdmin (no educational ops) with no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Keep' });
    await expect(
      renameDepartment(techAdminContext(), DEPT, { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('archiveDepartment (TechnicalAdmin only — soft-delete)', () => {
  it('sets archived_at and returns the archived Department DTO', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Law' });

    const result = await archiveDepartment(techAdminContext(), DEPT, db);
    expect(result.id).toBe(DEPT);
    expect(result.archivedAt).toBeTruthy();
    expect(db.mutationCount).toBe(1);
  });

  it('throws NotFoundError when already archived or not found', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Law' });
    // First archive succeeds
    await archiveDepartment(techAdminContext(), DEPT, db);
    // Second archive on already-archived dept throws NotFoundError
    await expect(
      archiveDepartment(techAdminContext(), DEPT, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DepartmentAdmin with no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Keep' });
    await expect(
      archiveDepartment(deptAdminContext([DEPT]), DEPT, db),
    ).rejects.toThrow('TechnicalAdmin role required');
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Keep' });
    await expect(
      archiveDepartment(studentContext(), DEPT, db),
    ).rejects.toThrow('TechnicalAdmin role required');
    expect(db.mutationCount).toBe(0);
  });

  it('archived department no longer appears in listDepartments', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Retiring' });
    db.seedDepartment({ id: 'dept-2', name: 'Active' });

    await archiveDepartment(techAdminContext(), DEPT, db);
    const names = (await listDepartments(db)).map((d) => d.name);
    expect(names).not.toContain('Retiring');
    expect(names).toContain('Active');
  });
});

describe('Department owns no Users (Requirement 28.1 / 28.2)', () => {
  it('the department row carries only grouping fields — no user/owner column', () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT, name: 'Allard' });
    expect(Object.keys(db.departments.get(DEPT)!).sort()).toEqual(['access_state', 'archived_at', 'id', 'name', 'prompt']);
  });
});
