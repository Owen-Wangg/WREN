/**
 * Unit tests for Document-Type-scoped Reference Material management
 * (REQ-REFMAT-MGMT-01 / Requirement 26; Task 12.5).
 *
 * Covers file/text/html inputs, no-partial-persistence on a mismatched
 * content-kind/content-source pairing, tier-1 vs tier-2 visibility scoping,
 * and capability enforcement (deny with no mutation).
 */
import type { AuthContext } from '@wren/types';

import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  createReferenceMaterial,
  deleteReferenceMaterial,
  getReferenceMaterial,
  listDepartmentReferenceMaterial,
  listDocumentTypeReferenceMaterial,
  setReferenceMaterialEmbeddingId,
} from './referenceMaterialService';

const DEPT = 'dept-1';
const OTHER_DEPT = 'dept-2';
const DT = 'dt-1';

function mixedAdminContext(departmentIds: string[]): AuthContext {
  return {
    ...techAdminContext(),
    roles: ['TechnicalAdmin', 'DepartmentAdmin'],
    administeredDepartmentIds: departmentIds,
  };
}

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDepartment({ id: OTHER_DEPT, name: 'Sauder Business' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
}

describe('createReferenceMaterial — tier 1 (department-wide)', () => {
  it('lets a DeptAdmin create department-wide pasted-text material', async () => {
    const db = new FakeDb();
    seed(db);

    const mat = await createReferenceMaterial(
      deptAdminContext([DEPT]),
      {
        tier: 'department',
        departmentId: DEPT,
        title: 'Citation Style Guide',
        contentKind: 'text',
        inlineContent: 'Use Bluebook citation format throughout.',
      },
      db,
    );

    expect(mat).toMatchObject({
      tier: 'department',
      departmentId: DEPT,
      documentTypeId: null,
      title: 'Citation Style Guide',
      contentKind: 'text',
      inlineContent: 'Use Bluebook citation format throughout.',
      embeddingId: null,
    });
  });

  it('accepts a file upload with an s3Key', async () => {
    const db = new FakeDb();
    seed(db);

    const mat = await createReferenceMaterial(
      deptAdminContext([DEPT]),
      {
        tier: 'department',
        departmentId: DEPT,
        title: 'Handbook PDF',
        contentKind: 'file',
        s3Key: 'refmat/handbook.pdf',
      },
      db,
    );

    expect(mat.contentKind).toBe('file');
    expect(mat.s3Key).toBe('refmat/handbook.pdf');
  });

  it('accepts rich HTML content', async () => {
    const db = new FakeDb();
    seed(db);

    const mat = await createReferenceMaterial(
      deptAdminContext([DEPT]),
      {
        tier: 'department',
        departmentId: DEPT,
        title: 'Formatted Guide',
        contentKind: 'html',
        inlineContent: '<p>Use <strong>active voice</strong>.</p>',
      },
      db,
    );

    expect(mat.contentKind).toBe('html');
    expect(mat.inlineContent).toContain('<strong>');
  });

  it('rejects a file contentKind with no s3Key — NO partial persistence', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([DEPT]),
        { tier: 'department', departmentId: DEPT, title: 'Bad', contentKind: 'file' },
        db,
      ),
    ).rejects.toThrow(/s3Key is required/);
    expect(db.mutationCount).toBe(0);
    expect(db.referenceMaterials.size).toBe(0);
  });

  it('rejects a text contentKind with no inlineContent — NO partial persistence', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([DEPT]),
        { tier: 'department', departmentId: DEPT, title: 'Bad', contentKind: 'text' },
        db,
      ),
    ).rejects.toThrow(/inlineContent is required/);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a DeptAdmin of a different Department with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([OTHER_DEPT]),
        { tier: 'department', departmentId: DEPT, title: 'X', contentKind: 'text', inlineContent: 'y' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        studentContext(),
        { tier: 'department', departmentId: DEPT, title: 'X', contentKind: 'text', inlineContent: 'y' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a TechnicalAdmin with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        techAdminContext(),
        { tier: 'department', departmentId: DEPT, title: 'X', contentKind: 'text', inlineContent: 'y' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('allows a mixed-role actor through a correctly scoped DepartmentAdmin appointment', async () => {
    const db = new FakeDb();
    seed(db);

    const material = await createReferenceMaterial(
      mixedAdminContext([DEPT]),
      { tier: 'department', departmentId: DEPT, title: 'Guide', contentKind: 'text', inlineContent: 'y' },
      db,
    );

    expect(material.departmentId).toBe(DEPT);
  });

  it('does not let a mixed-role actor bypass DepartmentAdmin scope', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        mixedAdminContext([OTHER_DEPT]),
        { tier: 'department', departmentId: DEPT, title: 'X', contentKind: 'text', inlineContent: 'y' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('createReferenceMaterial — tier 2 (Document-Type-scoped)', () => {
  it('lets a DeptAdmin create Document-Type-scoped material', async () => {
    const db = new FakeDb();
    seed(db);

    const mat = await createReferenceMaterial(
      deptAdminContext([DEPT]),
      {
        tier: 'type',
        departmentId: DEPT,
        documentTypeId: DT,
        title: 'Memo Structure Guide',
        contentKind: 'text',
        inlineContent: 'A memo opens with a one-sentence issue statement.',
      },
      db,
    );

    expect(mat.tier).toBe('type');
    expect(mat.documentTypeId).toBe(DT);
  });

  it('rejects tier "type" with no documentTypeId', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([DEPT]),
        { tier: 'type', departmentId: DEPT, title: 'X', contentKind: 'text', inlineContent: 'y' },
        db,
      ),
    ).rejects.toThrow(/documentTypeId is required/);
  });

  it('rejects a documentTypeId/departmentId pairing that does not match', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([OTHER_DEPT]),
        {
          tier: 'type',
          departmentId: OTHER_DEPT,
          documentTypeId: DT, // DT actually belongs to DEPT, not OTHER_DEPT
          title: 'X',
          contentKind: 'text',
          inlineContent: 'y',
        },
        db,
      ),
    ).rejects.toThrow(/does not belong to/);
  });

  it('denies a DeptAdmin who does not administer the Document Type\'s Department', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([OTHER_DEPT]),
        {
          tier: 'type',
          departmentId: DEPT,
          documentTypeId: DT,
          title: 'X',
          contentKind: 'text',
          inlineContent: 'y',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createReferenceMaterial(
        deptAdminContext([DEPT]),
        {
          tier: 'type',
          departmentId: DEPT,
          documentTypeId: 'missing',
          title: 'X',
          contentKind: 'text',
          inlineContent: 'y',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listDepartmentReferenceMaterial / listDocumentTypeReferenceMaterial — visibility scoping', () => {
  it('lists only tier-1 materials for the given Department, ordered by title', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({ id: 'r1', department_id: DEPT, tier: 'department', title: 'Zebra Guide' });
    db.seedReferenceMaterial({ id: 'r2', department_id: DEPT, tier: 'department', title: 'Alpha Guide' });
    db.seedReferenceMaterial({
      id: 'r3',
      department_id: DEPT,
      tier: 'type',
      document_type_id: DT,
      title: 'Type-scoped',
    });
    db.seedReferenceMaterial({ id: 'r4', department_id: OTHER_DEPT, tier: 'department', title: 'Other dept' });

    const materials = await listDepartmentReferenceMaterial(DEPT, db);

    expect(materials.map((m) => m.title)).toEqual(['Alpha Guide', 'Zebra Guide']);
  });

  it('lists only tier-2 materials scoped to the given Document Type', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({
      id: 'r1',
      department_id: DEPT,
      tier: 'type',
      document_type_id: DT,
      title: 'Memo Guide',
    });
    db.seedReferenceMaterial({ id: 'r2', department_id: DEPT, tier: 'department', title: 'Dept-wide Guide' });

    const materials = await listDocumentTypeReferenceMaterial(DT, db);

    expect(materials).toHaveLength(1);
    expect(materials[0]?.title).toBe('Memo Guide');
  });
});

describe('setReferenceMaterialEmbeddingId', () => {
  it('records the embedding linkage once indexing completes', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({ id: 'r1', department_id: DEPT, tier: 'department', title: 'Guide' });

    const updated = await setReferenceMaterialEmbeddingId('r1', 'emb-123', db);

    expect(updated.embeddingId).toBe('emb-123');
  });

  it('throws NotFoundError for an unknown material', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(setReferenceMaterialEmbeddingId('missing', 'emb-1', db)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('deleteReferenceMaterial', () => {
  it('removes a tier-1 entry (DeptAdmin for the owning Department)', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({ id: 'r1', department_id: DEPT, tier: 'department', title: 'Guide' });

    const deleted = await deleteReferenceMaterial(deptAdminContext([DEPT]), 'r1', db);

    expect(deleted).toBe(true);
    expect(await getReferenceMaterial('r1', db)).toBeNull();
  });

  it('removes a tier-2 entry scoped by its Document Type', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({
      id: 'r1',
      department_id: DEPT,
      tier: 'type',
      document_type_id: DT,
      title: 'Guide',
    });

    const deleted = await deleteReferenceMaterial(deptAdminContext([DEPT]), 'r1', db);

    expect(deleted).toBe(true);
  });

  it('returns false for an unknown id with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    const deleted = await deleteReferenceMaterial(deptAdminContext([DEPT]), 'missing', db);

    expect(deleted).toBe(false);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a DeptAdmin of a different Department with no mutation', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({ id: 'r1', department_id: DEPT, tier: 'department', title: 'Guide' });

    await expect(
      deleteReferenceMaterial(deptAdminContext([OTHER_DEPT]), 'r1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(await getReferenceMaterial('r1', db)).not.toBeNull();
  });

  it('denies a TechnicalAdmin — educational content is not a technical operation', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedReferenceMaterial({ id: 'r1', department_id: DEPT, tier: 'department', title: 'Guide' });

    await expect(deleteReferenceMaterial(techAdminContext(), 'r1', db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
