/**
 * Unit tests for the Document-Type-scoped error taxonomy (REQ-TAXONOMY-01 /
 * Requirement 15; Task 12.1).
 *
 * Covers CRUD, that categories are user-configurable DATA (not an enum),
 * rename preserving `id` linkage (Requirement 15.3), `internalGuidance`
 * never leaking into a name-only projection, capability enforcement (deny
 * with no mutation), and that mutations touch `document_type_config.updatedAt`
 * (carry-forward invalidation, Requirement 27.3).
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  createErrorCategory,
  deleteErrorCategory,
  getErrorCategory,
  listErrorCategories,
  updateErrorCategory,
} from './errorCategoryService';

const DEPT = 'dept-1';
const DT = 'dt-1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
}

describe('createErrorCategory (Requirement 15.1, 15.2)', () => {
  it('lets a DeptAdmin add a category as configurable data', async () => {
    const db = new FakeDb();
    seed(db);

    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Passive Voice' },
      db,
    );

    expect(cat).toEqual({
      id: expect.any(String),
      documentTypeId: DT,
      name: 'Passive Voice',
      internalGuidance: null,
    });
  });

  it('stores internalGuidance as a detection aid', async () => {
    const db = new FakeDb();
    seed(db);

    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Weak Thesis', internalGuidance: 'Look for hedging language.' },
      db,
    );

    expect(cat.internalGuidance).toBe('Look for hedging language.');
  });

  it('supports arbitrary category names — never a fixed enum', async () => {
    const db = new FakeDb();
    seed(db);
    const admin = deptAdminContext([DEPT]);

    for (const name of ['Ambiguous Pronoun', 'Unsupported Claim', 'Citation Format']) {
      await createErrorCategory(admin, { documentTypeId: DT, name }, db);
    }

    const names = (await listErrorCategories(DT, db)).map((c) => c.name);
    expect(names).toEqual(['Ambiguous Pronoun', 'Citation Format', 'Unsupported Claim']);
  });

  it('touches document_type_config.updatedAt on add (carry-forward invalidation)', async () => {
    const db = new FakeDb();
    seed(db);

    await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'X' }, db);

    const config = db.documentTypeConfigs.get(DT);
    expect(config).toBeDefined();
    expect(config!.updated_at).toBeInstanceOf(Date);
  });

  it('denies a DeptAdmin of a different Department with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(deptAdminContext(['other-dept']), { documentTypeId: DT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.errorCategories.size).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(studentContext(), { documentTypeId: DT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a TechnicalAdmin — educational content is not a technical operation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(techAdminContext(), { documentTypeId: DT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: 'missing-dt', name: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateErrorCategory — rename preserves linkage (Requirement 15.3)', () => {
  it('renaming a category keeps its id unchanged', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Old Name' },
      db,
    );

    const renamed = await updateErrorCategory(
      deptAdminContext([DEPT]),
      cat.id,
      { name: 'New Name' },
      db,
    );

    expect(renamed.id).toBe(cat.id);
    expect(renamed.name).toBe('New Name');
  });

  it('can update internalGuidance independently of name', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);

    const updated = await updateErrorCategory(
      deptAdminContext([DEPT]),
      cat.id,
      { internalGuidance: 'New guidance' },
      db,
    );

    expect(updated.name).toBe('A');
    expect(updated.internalGuidance).toBe('New guidance');
  });

  it('is a no-op returning the current record when the patch is empty', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);
    const mutationsBefore = db.mutationCount;

    const result = await updateErrorCategory(deptAdminContext([DEPT]), cat.id, {}, db);

    expect(result).toEqual(cat);
    expect(db.mutationCount).toBe(mutationsBefore);
  });

  it('throws NotFoundError for an unknown category', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      updateErrorCategory(deptAdminContext([DEPT]), 'missing', { name: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DeptAdmin of a different Department with no mutation', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);
    const mutationsBefore = db.mutationCount;

    await expect(
      updateErrorCategory(deptAdminContext(['other-dept']), cat.id, { name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(mutationsBefore);
  });
});

describe('deleteErrorCategory', () => {
  it('removes a category (DeptAdmin for the administering Department)', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);

    const deleted = await deleteErrorCategory(deptAdminContext([DEPT]), cat.id, db);

    expect(deleted).toBe(true);
    expect(await getErrorCategory(cat.id, db)).toBeNull();
  });

  it('returns false for an unknown id with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    const deleted = await deleteErrorCategory(deptAdminContext([DEPT]), 'missing', db);

    expect(deleted).toBe(false);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);
    const mutationsBefore = db.mutationCount;

    await expect(deleteErrorCategory(studentContext(), cat.id, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.mutationCount).toBe(mutationsBefore);
    expect(await getErrorCategory(cat.id, db)).not.toBeNull();
  });
});
