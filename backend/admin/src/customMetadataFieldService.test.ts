/**
 * Unit tests for DepartmentAdmin-defined custom metadata fields scoped to a
 * Document Type (REQ-ORG-CONFIG-01 / Requirement 30.3), the required/optional
 * flag, and the "Writing Topic" seeding helper (tasks.md product decision 1:
 * ONLY "Writing Topic" is ever seeded — "Location Reference" never is).
 *
 * TechnicalAdmin may bootstrap this Document Type catalog through the explicit
 * `documentType.manageCatalog` matrix entry; Students remain denied.
 */
import {
  WRITING_TOPIC_LABEL,
  createCustomMetadataField,
  deleteCustomMetadataField,
  getCustomMetadataField,
  listCustomMetadataFields,
  seedWritingTopicField,
  updateCustomMetadataField,
} from './customMetadataFieldService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT = 'dept-1';
const DT = 'dt-1';

function seedDeptAndDocumentType(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Writing' });
}

describe('createCustomMetadataField (Requirement 30.3)', () => {
  it('lets a DeptAdmin define an optional field by default', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);

    const field = await createCustomMetadataField(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, label: 'Case Number' },
      db,
    );

    expect(field).toEqual({
      id: expect.any(String),
      documentTypeId: DT,
      label: 'Case Number',
      required: false,
    });
  });

  it('lets a DeptAdmin mark a field required', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    const field = await createCustomMetadataField(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, label: 'Jurisdiction', required: true },
      db,
    );
    expect(field.required).toBe(true);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      createCustomMetadataField(deptAdminContext([DEPT]), { documentTypeId: 'missing', label: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DeptAdmin of a DIFFERENT department with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    await expect(
      createCustomMetadataField(
        deptAdminContext(['other-dept']),
        { documentTypeId: DT, label: 'X' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.size).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    await expect(
      createCustomMetadataField(studentContext(), { documentTypeId: DT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('allows a TechnicalAdmin to bootstrap a catalog field', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);

    const field = await createCustomMetadataField(
      techAdminContext(),
      { documentTypeId: DT, label: 'X' },
      db,
    );

    expect(field).toMatchObject({ documentTypeId: DT, label: 'X', required: false });
    expect(db.mutationCount).toBe(1);
  });
});

describe('seedWritingTopicField (tasks.md product decision 1)', () => {
  it('creates exactly a "Writing Topic" field, optional by default', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);

    const field = await seedWritingTopicField(deptAdminContext([DEPT]), DT, db);

    expect(field.label).toBe(WRITING_TOPIC_LABEL);
    expect(field.label).toBe('Writing Topic');
    expect(field.required).toBe(false);
    expect(field.documentTypeId).toBe(DT);
  });

  it('never seeds "Location Reference" under any circumstance', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);

    await seedWritingTopicField(deptAdminContext([DEPT]), DT, db);

    const labels = (await listCustomMetadataFields(DT, db)).map((f) => f.label);
    expect(labels).toEqual(['Writing Topic']);
    expect(labels).not.toContain('Location Reference');
  });

  it('still enforces the catalog-management capability (denies with no mutation)', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    await expect(seedWritingTopicField(studentContext(), DT, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.size).toBe(0);
  });
});

describe('read custom metadata fields', () => {
  it('gets by id (null when absent) and lists per Document Type ordered by label', async () => {
    const db = new FakeDb();
    db.seedCustomMetadataField({ id: 'cmf-b', document_type_id: DT, label: 'Beta' });
    db.seedCustomMetadataField({ id: 'cmf-a', document_type_id: DT, label: 'Alpha' });
    db.seedCustomMetadataField({ id: 'cmf-x', document_type_id: 'other-dt', label: 'Elsewhere' });

    expect(await getCustomMetadataField('cmf-a', db)).toMatchObject({
      id: 'cmf-a',
      label: 'Alpha',
    });
    expect(await getCustomMetadataField('missing', db)).toBeNull();

    const labels = (await listCustomMetadataFields(DT, db)).map((f) => f.label);
    expect(labels).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateCustomMetadataField — required/optional flag behavior', () => {
  it('lets a DeptAdmin toggle required true -> false', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      document_type_id: DT,
      label: 'Writing Topic',
      required: true,
    });

    const updated = await updateCustomMetadataField(
      deptAdminContext([DEPT]),
      'cmf-1',
      { required: false },
      db,
    );
    expect(updated).toMatchObject({ label: 'Writing Topic', required: false });
  });

  it('lets a DeptAdmin toggle required false -> true independently of label', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      document_type_id: DT,
      label: 'Writing Topic',
      required: false,
    });

    const updated = await updateCustomMetadataField(
      deptAdminContext([DEPT]),
      'cmf-1',
      { required: true },
      db,
    );
    expect(updated).toMatchObject({ label: 'Writing Topic', required: true });
  });

  it('throws NotFoundError for an unknown field', async () => {
    const db = new FakeDb();
    await expect(
      updateCustomMetadataField(deptAdminContext([DEPT]), 'missing', { required: true }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (Student) with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      document_type_id: DT,
      label: 'Writing Topic',
      required: false,
    });
    await expect(
      updateCustomMetadataField(studentContext(), 'cmf-1', { required: true }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.get('cmf-1')!.required).toBe(false);
  });

  it('allows a TechnicalAdmin to update a bootstrap catalog field', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      document_type_id: DT,
      label: 'Writing Topic',
      required: false,
    });

    const updated = await updateCustomMetadataField(
      techAdminContext(),
      'cmf-1',
      { required: true },
      db,
    );

    expect(updated.required).toBe(true);
    expect(db.mutationCount).toBe(1);
  });
});

describe('deleteCustomMetadataField', () => {
  it('lets a DeptAdmin delete a field in an administered dept', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({ id: 'cmf-1', document_type_id: DT, label: 'Bye' });

    expect(await deleteCustomMetadataField(deptAdminContext([DEPT]), 'cmf-1', db)).toBe(true);
    expect(await getCustomMetadataField('cmf-1', db)).toBeNull();
  });

  it('returns false for an unknown field', async () => {
    const db = new FakeDb();
    expect(await deleteCustomMetadataField(deptAdminContext([DEPT]), 'missing', db)).toBe(false);
  });

  it('denies a DeptAdmin of a different dept with no mutation', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({ id: 'cmf-1', document_type_id: DT, label: 'Keep' });
    await expect(
      deleteCustomMetadataField(deptAdminContext(['other-dept']), 'cmf-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.has('cmf-1')).toBe(true);
  });

  it('allows a TechnicalAdmin to delete a bootstrap catalog field', async () => {
    const db = new FakeDb();
    seedDeptAndDocumentType(db);
    db.seedCustomMetadataField({ id: 'cmf-1', document_type_id: DT, label: 'Keep' });

    expect(await deleteCustomMetadataField(techAdminContext(), 'cmf-1', db)).toBe(true);
    expect(db.customMetadataFields.has('cmf-1')).toBe(false);
  });
});
