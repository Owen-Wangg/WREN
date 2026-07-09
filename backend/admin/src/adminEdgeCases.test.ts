/**
 * Unit tests for Admin role/access edge cases (V4):
 *
 *   1. Cross-department scope denials — a `DepartmentAdmin` of Department X is
 *      denied any dept-scoped operation against Department Y, with no mutation.
 *   2. TechnicalAdmin denied educational content operations — TechnicalAdmin
 *      CANNOT manageCatalog, topic.manage, or any DeptAdmin educational op.
 *   3. DepartmentAdmin denied role assignment operations — only TechnicalAdmin
 *      can assign/revoke roles.
 *
 * V4 has NO superuser fallback. There is no concept of a TechnicalAdmin
 * performing educational operations on behalf of an absent DepartmentAdmin.
 */
import { createAccessGrant } from './accessGrantService';
import { createContentType, updateContentType, deleteContentType } from './contentTypeService';
import {
  createCustomMetadataField,
  updateCustomMetadataField,
  deleteCustomMetadataField,
} from './customMetadataFieldService';
import { renameDepartment, deleteDepartment } from './departmentService';
import {
  createDocumentType,
  updateDocumentType,
  setDocumentTypeAccessState,
  deleteDocumentType,
  getDocumentTypeDeletionImpact,
} from './documentTypeService';
import { AuthorizationError } from './errors';
import { FakeDb } from './fakeDb';
import { assignRole, revokeRole } from './roleAssignmentService';
import { deptAdminContext, techAdminContext } from './testContexts';
import { createTopic, updateTopic, deleteTopic, getTopicDeletionImpact } from './topicService';

const DEPT_X = 'dept-x';
const DEPT_Y = 'dept-y';
const DT_Y = 'dt-y';
const USER = 'user-target';

/**
 * Seed two departments and a Document Type in dept Y. The DeptAdmin actor
 * administers DEPT_X only, so all ops against DEPT_Y resources should be denied.
 */
function seedCrossDeptFixture(db: FakeDb): void {
  db.seedDepartment({ id: DEPT_X, name: 'Department X' });
  db.seedDepartment({ id: DEPT_Y, name: 'Department Y' });
  db.seedDocumentType({ id: DT_Y, department_id: DEPT_Y, name: 'Type in Y' });
}

describe('Cross-department scope denials — DeptAdmin of dept X denied on dept Y', () => {
  it('denies createDocumentType for dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      createDocumentType(deptAdminContext([DEPT_X]), { departmentId: DEPT_Y, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies updateDocumentType for a type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      updateDocumentType(deptAdminContext([DEPT_X]), DT_Y, { name: 'Hijacked' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.documentTypes.get(DT_Y)!.name).toBe('Type in Y');
  });

  it('denies setDocumentTypeAccessState for a type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      setDocumentTypeAccessState(deptAdminContext([DEPT_X]), DT_Y, 'OPEN', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.documentTypes.get(DT_Y)!.access_state).toBe('LOCKED');
  });

  it('denies deleteDocumentType for a type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      deleteDocumentType(deptAdminContext([DEPT_X]), DT_Y, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.documentTypes.has(DT_Y)).toBe(true);
  });

  it('denies getDocumentTypeDeletionImpact for a type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      getDocumentTypeDeletionImpact(deptAdminContext([DEPT_X]), DT_Y, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('denies createContentType for a Document Type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      createContentType(deptAdminContext([DEPT_X]), { documentTypeId: DT_Y, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies updateContentType for a Content Type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedContentType({ id: 'ct-y', document_type_id: DT_Y, label: 'Keep' });
    await expect(
      updateContentType(deptAdminContext([DEPT_X]), 'ct-y', { label: 'Hijacked' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.get('ct-y')!.label).toBe('Keep');
  });

  it('denies deleteContentType for a Content Type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedContentType({ id: 'ct-y', document_type_id: DT_Y, label: 'Keep' });
    await expect(
      deleteContentType(deptAdminContext([DEPT_X]), 'ct-y', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies createCustomMetadataField for a Document Type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      createCustomMetadataField(
        deptAdminContext([DEPT_X]),
        { documentTypeId: DT_Y, label: 'X' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies updateCustomMetadataField for a field in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedCustomMetadataField({ id: 'cmf-y', document_type_id: DT_Y, label: 'Keep', required: false });
    await expect(
      updateCustomMetadataField(deptAdminContext([DEPT_X]), 'cmf-y', { required: true }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.get('cmf-y')!.required).toBe(false);
  });

  it('denies deleteCustomMetadataField for a field in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedCustomMetadataField({ id: 'cmf-y', document_type_id: DT_Y, label: 'Keep' });
    await expect(
      deleteCustomMetadataField(deptAdminContext([DEPT_X]), 'cmf-y', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies createTopic for dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      createTopic(deptAdminContext([DEPT_X]), { departmentId: DEPT_Y, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies updateTopic for a Topic in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedTopic({ id: 'topic-y', department_id: DEPT_Y, name: 'Keep' });
    await expect(
      updateTopic(deptAdminContext([DEPT_X]), 'topic-y', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies deleteTopic for a Topic in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedTopic({ id: 'topic-y', department_id: DEPT_Y, name: 'Keep' });
    await expect(
      deleteTopic(deptAdminContext([DEPT_X]), 'topic-y', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.has('topic-y')).toBe(true);
  });

  it('denies getTopicDeletionImpact for a Topic in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    db.seedTopic({ id: 'topic-y', department_id: DEPT_Y, name: 'Keep' });
    await expect(
      getTopicDeletionImpact(deptAdminContext([DEPT_X]), 'topic-y', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('denies createAccessGrant for a Document Type in dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      createAccessGrant(deptAdminContext([DEPT_X]), { userId: USER, documentTypeId: DT_Y }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies renameDepartment for dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      renameDepartment(deptAdminContext([DEPT_X]), DEPT_Y, { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.departments.get(DEPT_Y)!.name).toBe('Department Y');
  });

  it('denies deleteDepartment for dept Y', async () => {
    const db = new FakeDb();
    seedCrossDeptFixture(db);
    await expect(
      deleteDepartment(deptAdminContext([DEPT_X]), DEPT_Y, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.departments.has(DEPT_Y)).toBe(true);
  });
});

describe('TechnicalAdmin denied educational content operations (no superuser fallback)', () => {
  it('denies createDocumentType (documentType.manageCatalog)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    await expect(
      createDocumentType(techAdminContext(), { departmentId: DEPT_X, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies updateDocumentType (documentType.manageCatalog)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedDocumentType({ id: 'dt-x', department_id: DEPT_X, name: 'Keep' });
    await expect(
      updateDocumentType(techAdminContext(), 'dt-x', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies setDocumentTypeAccessState — WAIT: TechnicalAdmin CAN do this (platform-level op)', async () => {
    // documentType.setAccessState is a platform-level capability granted to TechnicalAdmin.
    // This is NOT an educational operation — it's a platform-level access control.
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedDocumentType({ id: 'dt-x', department_id: DEPT_X, name: 'Type', access_state: 'LOCKED' });
    const result = await setDocumentTypeAccessState(techAdminContext(), 'dt-x', 'OPEN', db);
    expect(result.accessState).toBe('OPEN');
  });

  it('denies deleteDocumentType (documentType.manageCatalog)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedDocumentType({ id: 'dt-x', department_id: DEPT_X, name: 'Keep' });
    await expect(
      deleteDocumentType(techAdminContext(), 'dt-x', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies createTopic (topic.manage)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    await expect(
      createTopic(techAdminContext(), { departmentId: DEPT_X, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies updateTopic (topic.manage)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedTopic({ id: 'topic-x', department_id: DEPT_X, name: 'Keep' });
    await expect(
      updateTopic(techAdminContext(), 'topic-x', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies deleteTopic (topic.manage)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedTopic({ id: 'topic-x', department_id: DEPT_X, name: 'Keep' });
    await expect(
      deleteTopic(techAdminContext(), 'topic-x', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies createContentType (documentType.manageCatalog)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedDocumentType({ id: 'dt-x', department_id: DEPT_X, name: 'Type' });
    await expect(
      createContentType(techAdminContext(), { documentTypeId: 'dt-x', label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies createCustomMetadataField (documentType.manageCatalog)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedDocumentType({ id: 'dt-x', department_id: DEPT_X, name: 'Type' });
    await expect(
      createCustomMetadataField(techAdminContext(), { documentTypeId: 'dt-x', label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies createAccessGrant (accessGrant.create)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept X' });
    db.seedDocumentType({ id: 'dt-x', department_id: DEPT_X, name: 'Type' });
    await expect(
      createAccessGrant(techAdminContext(), { userId: USER, documentTypeId: 'dt-x' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies renameDepartment (department.manage)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Keep' });
    await expect(
      renameDepartment(techAdminContext(), DEPT_X, { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies deleteDepartment (department.manage)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Keep' });
    await expect(
      deleteDepartment(techAdminContext(), DEPT_X, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('DepartmentAdmin denied role assignment operations', () => {
  it('denies assignRole (Student)', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        deptAdminContext([DEPT_X]),
        { userId: USER, role: 'Student', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies assignRole (DepartmentAdmin)', async () => {
    const db = new FakeDb();
    db.seedDepartment({ id: DEPT_X, name: 'Dept' });
    await expect(
      assignRole(
        deptAdminContext([DEPT_X]),
        { userId: USER, role: 'DepartmentAdmin', scope: { kind: 'department', departmentId: DEPT_X }, departmentId: DEPT_X },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies assignRole (TechnicalAdmin)', async () => {
    const db = new FakeDb();
    await expect(
      assignRole(
        deptAdminContext([DEPT_X]),
        { userId: USER, role: 'TechnicalAdmin', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies revokeRole', async () => {
    const db = new FakeDb();
    db.seedRoleAssignment({ id: 'ra-1', user_id: USER, role: 'Student', scope: null });
    await expect(
      revokeRole(
        deptAdminContext([DEPT_X]),
        { userId: USER, role: 'Student', scope: { kind: 'platform' } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.roleAssignments.has('ra-1')).toBe(true);
  });
});
