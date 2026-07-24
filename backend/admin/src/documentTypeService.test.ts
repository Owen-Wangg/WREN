/**
 * Unit tests for the configurable Document Type catalog (REQ-ORG-CONFIG-01 /
 * Requirement 30.1; REQ-ADMIN-FEATURES-01 / Requirement 33.2; product decision 2).
 *
 * Covers CRUD, that Document Types are user-configurable DATA (arbitrary new
 * rows can be added — not a fixed enumeration), OPEN/LOCKED access-state
 * control (no INHERIT), deletion-impact reporting, and capability enforcement
 * (a disallowed actor is denied with no mutation).
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  createDocumentType,
  deleteDocumentType,
  getDocumentType,
  getDocumentTypeDeletionImpact,
  listDocumentTypes,
  setDocumentTypeAccessState,
  updateDocumentType,
} from './documentTypeService';

const DEPT = 'dept-1';

function seedDepartment(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
}

describe('createDocumentType (Requirement 30.1)', () => {
  it('lets a DeptAdmin add a catalog record in an administered dept, defaulting to OPEN', async () => {
    const db = new FakeDb();
    seedDepartment(db);

    const dt = await createDocumentType(
      deptAdminContext([DEPT]),
      { departmentId: DEPT, name: 'Case Brief' },
      db,
    );

    expect(dt).toEqual({
      id: expect.any(String),
      departmentId: DEPT,
      name: 'Case Brief',
      accessState: 'OPEN',
      sizeLimitWords: null,
    });
  });

  it('lets a DeptAdmin add a catalog record with a size limit', async () => {
    const db = new FakeDb();
    seedDepartment(db);

    const dt = await createDocumentType(
      deptAdminContext([DEPT]),
      { departmentId: DEPT, name: 'Memo', sizeLimitWords: 5000 },
      db,
    );
    expect(dt.sizeLimitWords).toBe(5000);
  });

  it('treats Document Types as DATA: arbitrary new names can be added and listed', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    const admin = deptAdminContext([DEPT]);

    for (const name of ['Grant Proposal', 'Patent Claim', 'Screenplay Beat Sheet']) {
      await createDocumentType(admin, { departmentId: DEPT, name }, db);
    }

    const names = (await listDocumentTypes(DEPT, db)).map((d) => d.name);
    expect(names).toEqual(['Grant Proposal', 'Patent Claim', 'Screenplay Beat Sheet']);
  });

  it('denies a DeptAdmin of a DIFFERENT department with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    await expect(
      createDocumentType(deptAdminContext(['other-dept']), { departmentId: DEPT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.documentTypes.size).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    await expect(
      createDocumentType(studentContext(), { departmentId: DEPT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('allows a TechnicalAdmin to create a Document Type in any department', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    const dt = await createDocumentType(
      techAdminContext(),
      { departmentId: DEPT, name: 'Platform Bootstrap Type' },
      db,
    );
    expect(dt.name).toBe('Platform Bootstrap Type');
    expect(dt.departmentId).toBe(DEPT);
  });
});

describe('read Document Types', () => {
  it('gets by id (null when absent) and lists per department ordered by name', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-b', department_id: DEPT, name: 'Beta' });
    db.seedDocumentType({ id: 'dt-a', department_id: DEPT, name: 'Alpha' });
    db.seedDepartment({ id: 'other', name: 'Other' });
    db.seedDocumentType({ id: 'dt-x', department_id: 'other', name: 'Elsewhere' });

    expect(await getDocumentType('dt-a', db)).toMatchObject({ id: 'dt-a', name: 'Alpha' });
    expect(await getDocumentType('missing', db)).toBeNull();

    const names = (await listDocumentTypes(DEPT, db)).map((d) => d.name);
    expect(names).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateDocumentType', () => {
  it('lets a DeptAdmin rename and re-limit a catalog record in an administered dept', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'Old', size_limit_words: null });

    const updated = await updateDocumentType(
      deptAdminContext([DEPT]),
      'dt-1',
      { name: 'New', sizeLimitWords: 8000 },
      db,
    );
    expect(updated).toMatchObject({ name: 'New', sizeLimitWords: 8000, accessState: 'OPEN' });
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      updateDocumentType(deptAdminContext([DEPT]), 'missing', { name: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (Student) with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'Keep' });
    await expect(
      updateDocumentType(studentContext(), 'dt-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.documentTypes.get('dt-1')!.name).toBe('Keep');
  });

  it('denies a DeptAdmin of a different department with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'Keep' });
    await expect(
      updateDocumentType(deptAdminContext(['other-dept']), 'dt-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('setDocumentTypeAccessState (Requirement 28.4 / 33.2)', () => {
  it('lets a TechnicalAdmin flip between OPEN and LOCKED (department-wide)', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T', access_state: 'LOCKED' });
    db.seedDocumentType({ id: 'dt-2', department_id: DEPT, name: 'U', access_state: 'LOCKED' });

    const opened = await setDocumentTypeAccessState(techAdminContext(), 'dt-1', 'OPEN', db);
    expect(opened.accessState).toBe('OPEN');
    expect(db.departments.get(DEPT)!.access_state).toBe('OPEN');
    expect(db.documentTypes.get('dt-2')!.access_state).toBe('OPEN');

    const locked = await setDocumentTypeAccessState(techAdminContext(), 'dt-1', 'LOCKED', db);
    expect(locked.accessState).toBe('LOCKED');
    expect(db.departments.get(DEPT)!.access_state).toBe('LOCKED');
    expect(db.documentTypes.get('dt-2')!.access_state).toBe('LOCKED');
  });

  it('denies a DeptAdmin (department lock is TechnicalAdmin-only)', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T', access_state: 'LOCKED' });
    await expect(
      setDocumentTypeAccessState(deptAdminContext([DEPT]), 'dt-1', 'OPEN', db),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.departments.get(DEPT)!.access_state).toBe('OPEN');
    expect(db.documentTypes.get('dt-1')!.access_state).toBe('LOCKED');
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T', access_state: 'LOCKED' });
    await expect(
      setDocumentTypeAccessState(studentContext(), 'dt-1', 'OPEN', db),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.documentTypes.get('dt-1')!.access_state).toBe('LOCKED');
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      setDocumentTypeAccessState(techAdminContext(), 'missing', 'OPEN', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getDocumentTypeDeletionImpact (Requirement 30.5 — confirmation before removal)', () => {
  it('reports zero document count for a Document Type with no documents', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T' });

    const impact = await getDocumentTypeDeletionImpact(deptAdminContext([DEPT]), 'dt-1', db);
    expect(impact).toEqual({
      documentTypeId: 'dt-1',
      documentCount: 0,
    });
  });

  it('counts Documents scoped to the Document Type', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T' });
    db.seedDocument({ id: 'doc-1', document_type_id: 'dt-1' });
    db.seedDocument({ id: 'doc-2', document_type_id: 'dt-1' });
    db.seedDocument({ id: 'doc-3', document_type_id: 'dt-other' });

    const impact = await getDocumentTypeDeletionImpact(deptAdminContext([DEPT]), 'dt-1', db);
    expect(impact).toEqual({
      documentTypeId: 'dt-1',
      documentCount: 2,
    });
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      getDocumentTypeDeletionImpact(deptAdminContext([DEPT]), 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (Student) with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T' });
    await expect(
      getDocumentTypeDeletionImpact(studentContext(), 'dt-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a DeptAdmin of a different department', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'T' });
    await expect(
      getDocumentTypeDeletionImpact(deptAdminContext(['other-dept']), 'dt-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('deleteDocumentType', () => {
  it('lets a DeptAdmin delete a catalog record in an administered dept', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'Bye' });

    expect(await deleteDocumentType(deptAdminContext([DEPT]), 'dt-1', db)).toBe(true);
    expect(await getDocumentType('dt-1', db)).toBeNull();
  });

  it('returns false for an unknown Document Type', async () => {
    const db = new FakeDb();
    expect(await deleteDocumentType(deptAdminContext([DEPT]), 'missing', db)).toBe(false);
  });

  it('denies a DeptAdmin of a different dept with no mutation', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'Keep' });
    await expect(
      deleteDocumentType(deptAdminContext(['other-dept']), 'dt-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.documentTypes.has('dt-1')).toBe(true);
  });

  it('allows a TechnicalAdmin to delete a Document Type (shared catalog capability)', async () => {
    const db = new FakeDb();
    seedDepartment(db);
    db.seedDocumentType({ id: 'dt-1', department_id: DEPT, name: 'Keep' });
    await expect(deleteDocumentType(techAdminContext(), 'dt-1', db)).resolves.toBe(true);
    expect(db.documentTypes.has('dt-1')).toBe(false);
  });
});
