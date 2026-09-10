/**
 * Unit tests for department catalog read-scoping (DeptAdmin isolation).
 */
import {
  assertCanViewDepartment,
  canViewDepartment,
  filterDepartmentsForActor,
  filterDocumentTypesForActor,
  mustScopeDepartmentCatalog,
} from './departmentScope';
import { NotFoundError } from './errors';
import { listDepartments } from './departmentService';
import { listAllDocumentTypes, listDocumentTypes } from './documentTypeService';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const LAW = 'dept-law';
const TEST = 'dept-test';
const DT_LAW = 'dt-law';
const DT_TEST = 'dt-test';

function seedLawAndTest(db: FakeDb): void {
  db.seedDepartment({ id: LAW, name: 'Law' });
  db.seedDepartment({ id: TEST, name: 'Test Department' });
  db.seedDocumentType({ id: DT_LAW, department_id: LAW, name: 'Legal Memo' });
  db.seedDocumentType({ id: DT_TEST, department_id: TEST, name: 'Test Brief' });
}

describe('departmentScope helpers', () => {
  it('scopes DepartmentAdmin (non-TechnicalAdmin) to administered departments only', () => {
    const lawAdmin = deptAdminContext([LAW]);
    expect(mustScopeDepartmentCatalog(lawAdmin)).toBe(true);
    expect(canViewDepartment(lawAdmin, LAW)).toBe(true);
    expect(canViewDepartment(lawAdmin, TEST)).toBe(false);
    expect(() => assertCanViewDepartment(lawAdmin, TEST)).toThrow(NotFoundError);
  });

  it('does not scope TechnicalAdmin or Student', () => {
    expect(mustScopeDepartmentCatalog(techAdminContext())).toBe(false);
    expect(mustScopeDepartmentCatalog(studentContext())).toBe(false);
    expect(canViewDepartment(techAdminContext(), TEST)).toBe(true);
    expect(canViewDepartment(studentContext(), TEST)).toBe(true);
  });

  it('filters department and document-type lists for Law admin', () => {
    const lawAdmin = deptAdminContext([LAW]);
    const departments = filterDepartmentsForActor(lawAdmin, [
      { id: LAW, name: 'Law' },
      { id: TEST, name: 'Test Department' },
    ]);
    expect(departments.map((d) => d.id)).toEqual([LAW]);

    const types = filterDocumentTypesForActor(lawAdmin, [
      { id: DT_LAW, departmentId: LAW, name: 'Legal Memo' },
      { id: DT_TEST, departmentId: TEST, name: 'Test Brief' },
    ]);
    expect(types.map((t) => t.id)).toEqual([DT_LAW]);
  });

  it('returns the union for a dual-department admin', () => {
    const dual = deptAdminContext([LAW, TEST]);
    const departments = filterDepartmentsForActor(dual, [
      { id: LAW, name: 'Law' },
      { id: TEST, name: 'Test Department' },
      { id: 'other', name: 'Other' },
    ]);
    expect(departments.map((d) => d.id).sort()).toEqual([LAW, TEST].sort());
  });

  it('leaves TechnicalAdmin lists unfiltered', () => {
    const actor = techAdminContext();
    const departments = filterDepartmentsForActor(actor, [
      { id: LAW, name: 'Law' },
      { id: TEST, name: 'Test Department' },
    ]);
    expect(departments).toHaveLength(2);
  });
});

describe('department catalog isolation via list + scope', () => {
  it('Law admin listing departments never includes Test Department', async () => {
    const db = new FakeDb();
    seedLawAndTest(db);
    const actor = deptAdminContext([LAW]);
    const all = await listDepartments(actor, db);
    const scoped = filterDepartmentsForActor(actor, all);
    expect(scoped.map((d) => d.name)).toEqual(['Law']);
  });

  it('Test admin listing document types never includes Law types', async () => {
    const db = new FakeDb();
    seedLawAndTest(db);
    const all = await listAllDocumentTypes(db);
    const scoped = filterDocumentTypesForActor(deptAdminContext([TEST]), all);
    expect(scoped.map((t) => t.name)).toEqual(['Test Brief']);
  });

  it('foreign departmentId list is denied before query for Law admin', () => {
    const lawAdmin = deptAdminContext([LAW]);
    expect(() => assertCanViewDepartment(lawAdmin, TEST)).toThrow(NotFoundError);
  });

  it('TechnicalAdmin still sees Law and Test departments and types', async () => {
    const db = new FakeDb();
    seedLawAndTest(db);
    const actor = techAdminContext();
    const departments = filterDepartmentsForActor(actor, await listDepartments(actor, db));
    const types = filterDocumentTypesForActor(actor, await listAllDocumentTypes(db));
    expect(departments.map((d) => d.name).sort()).toEqual(['Law', 'Test Department']);
    expect(types.map((t) => t.name).sort()).toEqual(['Legal Memo', 'Test Brief']);
    expect(() => assertCanViewDepartment(actor, TEST)).not.toThrow();
    const testTypes = await listDocumentTypes(TEST, db);
    expect(testTypes).toHaveLength(1);
  });

  it('Law admin cannot view Test department document types by id gate', () => {
    const lawAdmin = deptAdminContext([LAW]);
    expect(canViewDepartment(lawAdmin, TEST)).toBe(false);
    expect(() => assertCanViewDepartment(lawAdmin, TEST)).toThrow(NotFoundError);
    // Content-type / error-category list handlers use this same gate for DeptAdmins.
    expect(mustScopeDepartmentCatalog(lawAdmin)).toBe(true);
  });
});
