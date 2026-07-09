/**
 * Unit tests for DepartmentAdmin-defined Content Types scoped to a Document
 * Type (REQ-ORG-CONFIG-01 / Requirement 30.2).
 *
 * Covers CRUD, scoping to a Document Type, and capability enforcement (a
 * disallowed actor is denied with no mutation). No superuser fallback —
 * TechnicalAdmin CANNOT perform educational operations.
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
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT = 'dept-1';
const DT = 'dt-1';

function seedDeptAndDocumentType(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Writing' });
}

describe('createContentType (Requirement 30.2)', () => {
  it('lets a DeptAdmin define a Content Type in an administered dept', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);

    const ct = await createContentType(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, label: 'Case Brief' },
      db,
    );

    expect(ct).toEqual({ id: expect.any(String), documentTypeId: DT, label: 'Case Brief' });
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      createContentType(deptAdminContext([DEPT]), { documentTypeId: 'missing', label: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DeptAdmin of a DIFFERENT department with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    await expect(
      createContentType(deptAdminContext(['other-dept']), { documentTypeId: DT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.size).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    await expect(
      createContentType(studentContext(), { documentTypeId: DT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a TechnicalAdmin (not a catalog-management authority) with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    await expect(
      createContentType(techAdminContext(), { documentTypeId: DT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('read Content Types', () => {
  it('gets by id (null when absent) and lists per Document Type ordered by label', async () => {
    const db = new FakeDb();
    db.seedContentType({ id: 'ct-b', document_type_id: DT, label: 'Beta' });
    db.seedContentType({ id: 'ct-a', document_type_id: DT, label: 'Alpha' });
    db.seedContentType({ id: 'ct-x', document_type_id: 'other-dt', label: 'Elsewhere' });

    expect(await getContentType('ct-a', db)).toMatchObject({ id: 'ct-a', label: 'Alpha' });
    expect(await getContentType('missing', db)).toBeNull();

    const labels = (await listContentTypes(DT, db)).map((c) => c.label);
    expect(labels).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateContentType', () => {
  it('lets a DeptAdmin relabel a Content Type in an administered dept', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedContentType({ id: 'ct-1', document_type_id: DT, label: 'Old' });

    const updated = await updateContentType(deptAdminContext([DEPT]), 'ct-1', { label: 'New' }, db);
    expect(updated).toMatchObject({ label: 'New' });
  });

  it('throws NotFoundError for an unknown Content Type', async () => {
    const db = new FakeDb();
    await expect(
      updateContentType(deptAdminContext([DEPT]), 'missing', { label: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (Student) with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedContentType({ id: 'ct-1', document_type_id: DT, label: 'Keep' });
    await expect(
      updateContentType(studentContext(), 'ct-1', { label: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.get('ct-1')!.label).toBe('Keep');
  });

  it('denies a DeptAdmin of a different department with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedContentType({ id: 'ct-1', document_type_id: DT, label: 'Keep' });
    await expect(
      updateContentType(deptAdminContext(['other-dept']), 'ct-1', { label: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.get('ct-1')!.label).toBe('Keep');
  });
});

describe('deleteContentType', () => {
  it('lets a DeptAdmin delete a Content Type in an administered dept', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedContentType({ id: 'ct-1', document_type_id: DT, label: 'Bye' });

    expect(await deleteContentType(deptAdminContext([DEPT]), 'ct-1', db)).toBe(true);
    expect(await getContentType('ct-1', db)).toBeNull();
  });

  it('returns false for an unknown Content Type', async () => {
    const db = new FakeDb();
    expect(await deleteContentType(deptAdminContext([DEPT]), 'missing', db)).toBe(false);
  });

  it('denies a DeptAdmin of a different dept with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedContentType({ id: 'ct-1', document_type_id: DT, label: 'Keep' });
    await expect(
      deleteContentType(deptAdminContext(['other-dept']), 'ct-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.has('ct-1')).toBe(true);
  });

  it('denies a TechnicalAdmin with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedContentType({ id: 'ct-1', document_type_id: DT, label: 'Keep' });
    await expect(
      deleteContentType(techAdminContext(), 'ct-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.has('ct-1')).toBe(true);
  });
});
