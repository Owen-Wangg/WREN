/**
 * Unit tests for DepartmentAdmin business Topics scoped to ONE administered
 * Department (REQ-TOPIC-01 / Requirement 35).
 *
 * Covers CRUD, scoping to a single Department, capability enforcement (a
 * disallowed actor is denied with no mutation), deletion-impact reporting
 * (count of Documents whose "Writing Topic" metadata matches the Topic's
 * name), value preservation on delete (a Document's metadata is never
 * altered/blanked), and that Topics never couple into any
 * taxonomy/feedback-related code path.
 *
 * No superuser fallback — TechnicalAdmin CANNOT perform educational operations.
 */
import { WRITING_TOPIC_LABEL } from './customMetadataFieldService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  createTopic,
  deleteTopic,
  getTopic,
  getTopicDeletionImpact,
  listTopics,
  updateTopic,
} from './topicService';

const DEPT = 'dept-1';
const OTHER_DEPT = 'dept-2';

function seedDept(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard' });
}

describe('createTopic (Requirement 35.1)', () => {
  it('lets a DeptAdmin create a Topic scoped to an administered dept', async () => {
    const db = new FakeDb();
    seedDept(db);

    const topic = await createTopic(
      deptAdminContext([DEPT]),
      { departmentId: DEPT, name: 'Contract Law' },
      db,
    );

    expect(topic).toEqual({ id: expect.any(String), departmentId: DEPT, name: 'Contract Law' });
  });

  it('associates a Topic with exactly ONE Department (Requirement 35.2)', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedDepartment({ id: OTHER_DEPT, name: 'Other School' });

    const topic = await createTopic(
      deptAdminContext([DEPT]),
      { departmentId: DEPT, name: 'Civil Procedure' },
      db,
    );

    expect(topic.departmentId).toBe(DEPT);
    expect(await listTopics(OTHER_DEPT, db)).toEqual([]);
  });

  it('denies a DeptAdmin of a DIFFERENT department with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    await expect(
      createTopic(deptAdminContext([OTHER_DEPT]), { departmentId: DEPT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.size).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    await expect(
      createTopic(studentContext(), { departmentId: DEPT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a TechnicalAdmin (not a Topic-management authority) with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    await expect(
      createTopic(techAdminContext(), { departmentId: DEPT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('read Topics', () => {
  it('gets by id (null when absent) and lists per department ordered by name', async () => {
    const db = new FakeDb();
    db.seedTopic({ id: 'topic-b', department_id: DEPT, name: 'Beta Topic' });
    db.seedTopic({ id: 'topic-a', department_id: DEPT, name: 'Alpha Topic' });
    db.seedTopic({ id: 'topic-x', department_id: OTHER_DEPT, name: 'Elsewhere' });

    expect(await getTopic('topic-a', db)).toMatchObject({ id: 'topic-a', name: 'Alpha Topic' });
    expect(await getTopic('missing', db)).toBeNull();

    const names = (await listTopics(DEPT, db)).map((t) => t.name);
    expect(names).toEqual(['Alpha Topic', 'Beta Topic']);
  });
});

describe('updateTopic (rename, Requirement 35.1)', () => {
  it('lets a DeptAdmin rename a Topic in an administered dept', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Old Name' });

    const updated = await updateTopic(deptAdminContext([DEPT]), 'topic-1', { name: 'New Name' }, db);
    expect(updated).toMatchObject({ name: 'New Name' });
  });

  it('throws NotFoundError for an unknown Topic', async () => {
    const db = new FakeDb();
    await expect(
      updateTopic(deptAdminContext([DEPT]), 'missing', { name: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (Student) with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Keep' });
    await expect(
      updateTopic(studentContext(), 'topic-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.get('topic-1')!.name).toBe('Keep');
  });

  it('denies a DeptAdmin of a different dept with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Keep' });
    await expect(
      updateTopic(deptAdminContext([OTHER_DEPT]), 'topic-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a TechnicalAdmin with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Keep' });
    await expect(
      updateTopic(techAdminContext(), 'topic-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('getTopicDeletionImpact (Requirement 35.5 — confirmation before removal)', () => {
  it('reports zero when no Document references the Topic name', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Contract Law' });

    const impact = await getTopicDeletionImpact(deptAdminContext([DEPT]), 'topic-1', db);
    expect(impact).toEqual({ topicId: 'topic-1', documentCountReferencingName: 0 });
  });

  it('counts Documents whose "Writing Topic" metadata matches the Topic name', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Contract Law' });
    db.seedDocument({
      id: 'doc-1',
      document_type_id: 'dt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Contract Law' },
    });
    db.seedDocument({
      id: 'doc-2',
      document_type_id: 'dt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Contract Law' },
    });
    // Different metadata value — must not be counted.
    db.seedDocument({
      id: 'doc-3',
      document_type_id: 'dt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Torts' },
    });
    // No metadata at all — must not be counted / must not throw.
    db.seedDocument({ id: 'doc-4', document_type_id: 'dt-1' });

    const impact = await getTopicDeletionImpact(deptAdminContext([DEPT]), 'topic-1', db);
    expect(impact).toEqual({ topicId: 'topic-1', documentCountReferencingName: 2 });
  });

  it('throws NotFoundError for an unknown Topic', async () => {
    const db = new FakeDb();
    await expect(
      getTopicDeletionImpact(deptAdminContext([DEPT]), 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (Student) — a read-only report still enforces the capability', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Contract Law' });
    await expect(
      getTopicDeletionImpact(studentContext(), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a DeptAdmin of a different department', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Contract Law' });
    await expect(
      getTopicDeletionImpact(deptAdminContext([OTHER_DEPT]), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('deleteTopic — value preservation (Requirement 35.5)', () => {
  it('lets a DeptAdmin delete a Topic in an administered dept', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Bye' });

    expect(await deleteTopic(deptAdminContext([DEPT]), 'topic-1', db)).toBe(true);
    expect(await getTopic('topic-1', db)).toBeNull();
  });

  it('returns false for an unknown Topic', async () => {
    const db = new FakeDb();
    expect(await deleteTopic(deptAdminContext([DEPT]), 'missing', db)).toBe(false);
  });

  it('denies a DeptAdmin of a different dept with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Keep' });
    await expect(
      deleteTopic(deptAdminContext([OTHER_DEPT]), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.has('topic-1')).toBe(true);
  });

  it('denies a TechnicalAdmin with no mutation', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Keep' });
    await expect(
      deleteTopic(techAdminContext(), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.has('topic-1')).toBe(true);
  });

  it('does NOT alter or blank a referencing Document\'s metadata after deletion', async () => {
    const db = new FakeDb();
    seedDept(db);
    db.seedTopic({ id: 'topic-1', department_id: DEPT, name: 'Contract Law' });
    const doc = db.seedDocument({
      id: 'doc-1',
      document_type_id: 'dt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Contract Law' },
    });

    // Confirm impact first, as callers are expected to (Requirement 35.5).
    const impact = await getTopicDeletionImpact(deptAdminContext([DEPT]), 'topic-1', db);
    expect(impact.documentCountReferencingName).toBe(1);

    expect(await deleteTopic(deptAdminContext([DEPT]), 'topic-1', db)).toBe(true);

    // The Topic catalog entry is gone, but the Document's own stored metadata
    // value is untouched — it is an independent string, never a foreign key
    // to `topic.id`.
    expect(await getTopic('topic-1', db)).toBeNull();
    expect(doc.metadata).toEqual({ [WRITING_TOPIC_LABEL]: 'Contract Law' });
    expect(db.documents.get('doc-1')!.metadata).toEqual({
      [WRITING_TOPIC_LABEL]: 'Contract Law',
    });
  });
});

describe('Topics never drive taxonomy or feedback generation (Requirement 35.3)', () => {
  it('exposes no taxonomy/feedback-related exports or dependencies from this module', () => {
    const topicServiceModule = jest.requireActual('./topicService') as Record<string, unknown>;
    const exportNames = Object.keys(topicServiceModule);
    const taxonomyOrFeedbackNames = exportNames.filter((name) =>
      /taxonomy|feedback|errorCategory|prompt/i.test(name),
    );
    expect(taxonomyOrFeedbackNames).toEqual([]);
  });
});
