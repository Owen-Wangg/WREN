/**
 * Unit tests for department catalog read-scoping (DeptAdmin isolation).
 */
import {
  assertCanViewDepartment,
  canViewDepartment,
  filterDepartmentsForActor,
  filterDocumentTypesForActor,
  mustScopeDepartmentCatalog,
  redactDepartmentPrompt,
} from './departmentScope';
import { NotFoundError } from './errors';
import {
  listDepartments,
  updateDepartmentAskWrenPrompt,
  updateDepartmentPrompt,
} from './departmentService';
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

describe('redactDepartmentPrompt (Feedback-Engine prompt read access)', () => {
  const law = { id: LAW, name: 'Law', prompt: 'Law context' };

  it('returns the prompt to a DepartmentAdmin of that department', () => {
    expect(redactDepartmentPrompt(deptAdminContext([LAW]), law).prompt).toBe('Law context');
  });

  it('strips the prompt for a DepartmentAdmin of a different department', () => {
    expect(redactDepartmentPrompt(deptAdminContext([TEST]), law).prompt).toBeUndefined();
  });

  it('returns the prompt to a TechnicalAdmin and strips it for a Student', () => {
    expect(redactDepartmentPrompt(techAdminContext(), law).prompt).toBe('Law context');
    expect(redactDepartmentPrompt(studentContext(), law).prompt).toBeUndefined();
  });

  it('only exposes administered departments in a full catalog listing', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: LAW, name: 'Law', prompt: 'Law context' });
    db.seedDepartment({ id: TEST, name: 'Test Department', prompt: 'Test context' });
    const actor = deptAdminContext([LAW]);

    const listed = (await listDepartments(actor, db)).map((d) => redactDepartmentPrompt(actor, d));
    expect(listed.find((d) => d.id === LAW)?.prompt).toBe('Law context');
    expect(listed.find((d) => d.id === TEST)?.prompt).toBeUndefined();
  });
});

/**
 * Write-path redaction: the PUT prompt / PUT ask-wren-prompt
 * handlers (handleUpdateDepartmentPrompt / handleUpdateDepartmentAskWrenPrompt)
 * now route their returned DTO through {@link redactDepartmentPrompt}, mirroring
 * the two read paths. The DTO these handlers return carries the confidential
 * Feedback-Engine `prompt` column (via RETURNING / RETURNING_WITH_ASK_WREN), so
 * the response must strip `prompt` and `askWrenPrompt` for a caller who may
 * not read them.
 */
describe('update responses redact the Feedback-Engine prompt (write-path parity)', () => {
  it('PUT ask-wren-prompt: keeps prompt for the authorized editor, strips it for a non-reader', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: LAW, name: 'Law', prompt: 'Law Feedback-Engine context' });
    const editor = deptAdminContext([LAW]);

    // The service DTO carries the confidential `prompt` and the edited field.
    const dto = await updateDepartmentAskWrenPrompt(
      editor,
      LAW,
      { askWrenPrompt: 'Formal register; legal memoranda.' },
      db,
    );
    expect(dto.prompt).toBe('Law Feedback-Engine context');
    expect(dto.askWrenPrompt).toBe('Formal register; legal memoranda.');

    // What the handler returns to the editor (own department): prompt retained.
    const authorized = redactDepartmentPrompt(editor, dto);
    expect(authorized.prompt).toBe('Law Feedback-Engine context');
    expect(authorized.askWrenPrompt).toBe('Formal register; legal memoranda.');

    // Same helper, non-reader actor: both privileged prompt fields are stripped
    // (the Ask WREN prompt is as confidential as the Feedback-Engine prompt).
    for (const nonReader of [studentContext(), deptAdminContext([TEST])]) {
      const redacted = redactDepartmentPrompt(nonReader, dto);
      expect(redacted.prompt).toBeUndefined();
      expect(redacted.askWrenPrompt).toBeUndefined();
    }
  });

  it('PUT prompt: keeps prompt for the authorized editor, strips it for a non-reader', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: LAW, name: 'Law', prompt: 'old context' });
    const editor = deptAdminContext([LAW]);

    const dto = await updateDepartmentPrompt(editor, LAW, { prompt: 'new context' }, db);
    expect(dto.prompt).toBe('new context');

    expect(redactDepartmentPrompt(editor, dto).prompt).toBe('new context');
    expect(redactDepartmentPrompt(techAdminContext(), dto).prompt).toBe('new context');
    expect(redactDepartmentPrompt(studentContext(), dto).prompt).toBeUndefined();
    expect(redactDepartmentPrompt(deptAdminContext([TEST]), dto).prompt).toBeUndefined();
  });
});
