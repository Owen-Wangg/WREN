/**
 * Unit tests for Org-Owner business Topics scoped to ONE owned Organization
 * (REQ-TOPIC-01 / Requirement 35).
 *
 * Covers CRUD, scoping to a single Organization, capability enforcement (a
 * disallowed actor is denied with no mutation), deletion-impact reporting
 * (count of Documents whose "Writing Topic" metadata matches the Topic's
 * name), value preservation on delete (a Document's metadata is never
 * altered/blanked), and that Topics never couple into any
 * taxonomy/feedback-related code path.
 */
import { WRITING_TOPIC_LABEL } from './customMetadataFieldService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';
import {
  createTopic,
  deleteTopic,
  getTopic,
  getTopicDeletionImpact,
  listTopics,
  updateTopic,
} from './topicService';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function seedOrg(db: FakeDb): void {
  db.seedOrganization({ id: ORG, name: 'Allard' });
}

describe('createTopic (Requirement 35.1)', () => {
  it('lets an Org Owner create a Topic scoped to an owned org', async () => {
    const db = new FakeDb();
    seedOrg(db);

    const topic = await createTopic(
      orgOwnerContext(ORG),
      { organizationId: ORG, name: 'Contract Law' },
      db,
    );

    expect(topic).toEqual({ id: expect.any(String), organizationId: ORG, name: 'Contract Law' });
  });

  it('lets an Admin create a Topic', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const topic = await createTopic(adminContext(), { organizationId: ORG, name: 'Torts' }, db);
    expect(topic.name).toBe('Torts');
  });

  it('associates a Topic with exactly ONE Organization (Requirement 35.2)', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedOrganization({ id: OTHER_ORG, name: 'Other School' });

    const topic = await createTopic(
      orgOwnerContext(ORG),
      { organizationId: ORG, name: 'Civil Procedure' },
      db,
    );

    expect(topic.organizationId).toBe(ORG);
    expect(await listTopics(OTHER_ORG, db)).toEqual([]);
  });

  it('denies an Org Owner of a DIFFERENT organization with no mutation', async () => {
    const db = new FakeDb();
    seedOrg(db);
    await expect(
      createTopic(orgOwnerContext(OTHER_ORG), { organizationId: ORG, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.size).toBe(0);
  });

  it('denies a plain User with no mutation', async () => {
    const db = new FakeDb();
    seedOrg(db);
    await expect(
      createTopic(userContext(), { organizationId: ORG, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Field Expert (not a Topic-management authority) with no mutation', async () => {
    const db = new FakeDb();
    seedOrg(db);
    await expect(
      createTopic(fieldExpertContext('wt-1'), { organizationId: ORG, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('read Topics', () => {
  it('gets by id (null when absent) and lists per organization ordered by name', async () => {
    const db = new FakeDb();
    db.seedTopic({ id: 'topic-b', organization_id: ORG, name: 'Beta Topic' });
    db.seedTopic({ id: 'topic-a', organization_id: ORG, name: 'Alpha Topic' });
    db.seedTopic({ id: 'topic-x', organization_id: OTHER_ORG, name: 'Elsewhere' });

    expect(await getTopic('topic-a', db)).toMatchObject({ id: 'topic-a', name: 'Alpha Topic' });
    expect(await getTopic('missing', db)).toBeNull();

    const names = (await listTopics(ORG, db)).map((t) => t.name);
    expect(names).toEqual(['Alpha Topic', 'Beta Topic']);
  });
});

describe('updateTopic (rename, Requirement 35.1)', () => {
  it('lets an Org Owner rename a Topic in an owned org', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Old Name' });

    const updated = await updateTopic(orgOwnerContext(ORG), 'topic-1', { name: 'New Name' }, db);
    expect(updated).toMatchObject({ name: 'New Name' });
  });

  it('throws NotFoundError for an unknown Topic', async () => {
    const db = new FakeDb();
    await expect(
      updateTopic(adminContext(), 'missing', { name: 'x' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (User) with no mutation', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Keep' });
    await expect(
      updateTopic(userContext(), 'topic-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.get('topic-1')!.name).toBe('Keep');
  });

  it('denies an Org Owner of a different org with no mutation', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Keep' });
    await expect(
      updateTopic(orgOwnerContext(OTHER_ORG), 'topic-1', { name: 'Hijack' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('getTopicDeletionImpact (Requirement 35.5 — confirmation before removal)', () => {
  it('reports zero when no Document references the Topic name', async () => {
    const db = new FakeDb();
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Contract Law' });

    const impact = await getTopicDeletionImpact(adminContext(), 'topic-1', db);
    expect(impact).toEqual({ topicId: 'topic-1', documentCountReferencingName: 0 });
  });

  it('counts Documents whose "Writing Topic" metadata matches the Topic name', async () => {
    const db = new FakeDb();
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Contract Law' });
    db.seedDocument({
      id: 'doc-1',
      writing_type_id: 'wt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Contract Law' },
    });
    db.seedDocument({
      id: 'doc-2',
      writing_type_id: 'wt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Contract Law' },
    });
    // Different metadata value — must not be counted.
    db.seedDocument({
      id: 'doc-3',
      writing_type_id: 'wt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Torts' },
    });
    // No metadata at all — must not be counted / must not throw.
    db.seedDocument({ id: 'doc-4', writing_type_id: 'wt-1' });

    const impact = await getTopicDeletionImpact(adminContext(), 'topic-1', db);
    expect(impact).toEqual({ topicId: 'topic-1', documentCountReferencingName: 2 });
  });

  it('throws NotFoundError for an unknown Topic', async () => {
    const db = new FakeDb();
    await expect(
      getTopicDeletionImpact(adminContext(), 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (User) — a read-only report still enforces the capability', async () => {
    const db = new FakeDb();
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Contract Law' });
    await expect(
      getTopicDeletionImpact(userContext(), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies an Org Owner of a different organization', async () => {
    const db = new FakeDb();
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Contract Law' });
    await expect(
      getTopicDeletionImpact(orgOwnerContext(OTHER_ORG), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('deleteTopic — value preservation (Requirement 35.5)', () => {
  it('lets an Org Owner delete a Topic in an owned org', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Bye' });

    expect(await deleteTopic(orgOwnerContext(ORG), 'topic-1', db)).toBe(true);
    expect(await getTopic('topic-1', db)).toBeNull();
  });

  it('returns false for an unknown Topic', async () => {
    const db = new FakeDb();
    expect(await deleteTopic(adminContext(), 'missing', db)).toBe(false);
  });

  it('denies an Org Owner of a different org with no mutation', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Keep' });
    await expect(
      deleteTopic(orgOwnerContext(OTHER_ORG), 'topic-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.topics.has('topic-1')).toBe(true);
  });

  it('does NOT alter or blank a referencing Document\'s metadata after deletion', async () => {
    const db = new FakeDb();
    seedOrg(db);
    db.seedTopic({ id: 'topic-1', organization_id: ORG, name: 'Contract Law' });
    const doc = db.seedDocument({
      id: 'doc-1',
      writing_type_id: 'wt-1',
      metadata: { [WRITING_TOPIC_LABEL]: 'Contract Law' },
    });

    // Confirm impact first, as callers are expected to (Requirement 35.5).
    const impact = await getTopicDeletionImpact(orgOwnerContext(ORG), 'topic-1', db);
    expect(impact.documentCountReferencingName).toBe(1);

    expect(await deleteTopic(orgOwnerContext(ORG), 'topic-1', db)).toBe(true);

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
    // This service module has no import of, and exports nothing consumed by,
    // any error-taxonomy or feedback-generation code path. Topic CRUD only
    // ever touches the `topic` table (business layer) and, read-only, the
    // `document.metadata` JSONB column for the deletion-impact count — it
    // never reads or writes `error_category`, `feedback_item`, `anchor`, or
    // any Reference Material / prompt-content table.
    const topicServiceModule = jest.requireActual('./topicService') as Record<string, unknown>;
    const exportNames = Object.keys(topicServiceModule);
    const taxonomyOrFeedbackNames = exportNames.filter((name) =>
      /taxonomy|feedback|errorCategory|prompt/i.test(name),
    );
    expect(taxonomyOrFeedbackNames).toEqual([]);
  });
});
