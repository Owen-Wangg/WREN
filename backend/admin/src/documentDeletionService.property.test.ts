/**
 * Property-based test: document deletion partitions operational vs retained
 * state (Task 14.6).
 *
 * Feature: wren-writing-coach, Property 27: Document deletion partitions operational vs retained state
 *
 * Design Property 27: For any Document with Drafts, Feedback Items, Anchors,
 * resolution history, and derived activity events, deleting the Document
 * removes all of its per-Student operational state while leaving the
 * activity-log events and aggregate analytics counters intact.
 *
 * Validates: Requirements 45.1, 45.4, 44.2, 43.4, 39.3
 */
import fc from 'fast-check';

import { FakeDb } from './fakeDb';
import { deptAdminContext } from './testContexts';
import { deleteDocument } from './documentDeletionService';
import { recordActivityEvent } from './activityLogService';
import { wrenProperty } from '../../../testing/typescript/property';

const ORIGINAL_SALT = process.env.WREN_ACTIVITY_PSEUDONYM_SALT;
beforeAll(() => { process.env.WREN_ACTIVITY_PSEUDONYM_SALT = 'test-salt-prop27'; });
afterAll(() => { process.env.WREN_ACTIVITY_PSEUDONYM_SALT = ORIGINAL_SALT; });

const DEPT = 'dept-1';
const DT = 'dt-1';

/** Arbitrary positive integer for counts (1-10 to keep tests fast). */
const smallCountArb = fc.integer({ min: 1, max: 10 });

/** Arbitrary non-empty string id. */
const idArb = fc.string({ minLength: 3, maxLength: 12 }).filter((s) => /^[a-z0-9-]+$/.test(s));

/** Arbitrary verb for activity events. */
const verbArb = fc.constantFrom('uploaded', 'requested', 'regenerated', 'deleted');

/** Arbitrary aggregate counter value. */
const counterValueArb = fc.integer({ min: 1, max: 10000 });

interface DocScenario {
  docId: string;
  draftCount: number;
  feedbackItemCount: number;
  anchorCount: number;
  resolutionEntryCount: number;
  activityEventCount: number;
  aggregateCounterValue: number;
}

const scenarioArb: fc.Arbitrary<DocScenario> = fc.record({
  docId: idArb,
  draftCount: smallCountArb,
  feedbackItemCount: smallCountArb,
  anchorCount: smallCountArb,
  resolutionEntryCount: smallCountArb,
  activityEventCount: smallCountArb,
  aggregateCounterValue: counterValueArb,
});

/**
 * Seed a Document with the given counts of operational state and derived
 * activity-log events, plus an aggregate counter.
 */
async function seedScenario(db: FakeDb, scenario: DocScenario): Promise<void> {
  db.seedDepartment({ id: DEPT, name: 'Law' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Memo' });
  db.seedDocument({ id: scenario.docId, document_type_id: DT, owner_user_id: 'student-1' });

  // Seed drafts.
  const draftIds: string[] = [];
  for (let i = 0; i < scenario.draftCount; i++) {
    const draftId = `draft-${scenario.docId}-${i}`;
    db.seedDraft({ id: draftId, document_id: scenario.docId, version_number: i + 1 });
    draftIds.push(draftId);
  }

  // Seed feedback items.
  const feedbackItemIds: string[] = [];
  for (let i = 0; i < scenario.feedbackItemCount; i++) {
    const fiId = `fi-${scenario.docId}-${i}`;
    db.seedFeedbackItem({ id: fiId, document_id: scenario.docId });
    feedbackItemIds.push(fiId);
  }

  // Seed anchors (spread across drafts).
  for (let i = 0; i < scenario.anchorCount; i++) {
    const draftId = draftIds[i % draftIds.length]!;
    const fiId = feedbackItemIds[i % feedbackItemIds.length]!;
    db.seedAnchor({ id: `anc-${scenario.docId}-${i}`, draft_id: draftId, feedback_item_id: fiId });
  }

  // Seed resolution status history (spread across feedback items).
  for (let i = 0; i < scenario.resolutionEntryCount; i++) {
    const fiId = feedbackItemIds[i % feedbackItemIds.length]!;
    const draftId = draftIds[Math.min(i, draftIds.length - 1)]!;
    db.seedResolutionStatusHistory({
      id: `rsh-${scenario.docId}-${i}`,
      feedback_item_id: fiId,
      draft_id: draftId,
    });
  }

  // Seed activity-log events ABOUT this document (these must survive deletion).
  for (let i = 0; i < scenario.activityEventCount; i++) {
    await recordActivityEvent({
      actorUserId: 'student-1',
      verb: 'uploaded',
      objectType: 'Document',
      objectRef: scenario.docId,
      documentTypeId: DT,
      departmentId: DEPT,
    }, db);
  }

  // Seed an aggregate counter (must also survive deletion).
  db.seedAggregateCounter({
    id: `agg-${scenario.docId}`,
    scope_kind: 'documentType',
    scope_id: DT,
    metric: 'feedback_requested_count',
    window_start: new Date('2026-01-01T00:00:00.000Z'),
    value: scenario.aggregateCounterValue,
  });
}

describe('Property 27: Document deletion partitions operational vs retained state', () => {
  it('deleting a Document removes all per-Student operational state (Req 45.1, 39.3)', async () => {
    await wrenProperty(
      { number: 27, text: 'Document deletion partitions operational vs retained state' },
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const db = new FakeDb();
        await seedScenario(db, scenario);
        const actor = deptAdminContext([DEPT]);

        // Verify operational state exists before deletion.
        if (db.drafts.size === 0) return false;
        if (db.feedbackItems.size === 0) return false;
        if (db.anchors.size === 0) return false;
        if (db.resolutionStatusHistory.size === 0) return false;

        await deleteDocument(scenario.docId, true, actor, db);

        // All per-Student operational state must be gone.
        return (
          db.documents.size === 0 &&
          db.drafts.size === 0 &&
          db.feedbackItems.size === 0 &&
          db.anchors.size === 0 &&
          db.resolutionStatusHistory.size === 0
        );
      }),
    );
  });

  it('activity-log events survive document deletion (Req 45.4, 44.2)', async () => {
    await wrenProperty(
      { number: 27, text: 'Document deletion partitions operational vs retained state' },
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const db = new FakeDb();
        await seedScenario(db, scenario);
        const actor = deptAdminContext([DEPT]);

        const eventCountBefore = db.activityEvents.length;

        await deleteDocument(scenario.docId, true, actor, db);

        // Activity events must be completely unchanged.
        return db.activityEvents.length === eventCountBefore;
      }),
    );
  });

  it('aggregate analytics counters survive document deletion (Req 43.4)', async () => {
    await wrenProperty(
      { number: 27, text: 'Document deletion partitions operational vs retained state' },
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const db = new FakeDb();
        await seedScenario(db, scenario);
        const actor = deptAdminContext([DEPT]);

        const countersBefore = new Map(db.aggregateCounters);

        await deleteDocument(scenario.docId, true, actor, db);

        // Aggregate counters must be unchanged in both count and values.
        if (db.aggregateCounters.size !== countersBefore.size) return false;
        for (const [id, counter] of countersBefore) {
          const after = db.aggregateCounters.get(id);
          if (!after) return false;
          if (after.value !== counter.value) return false;
        }
        return true;
      }),
    );
  });

  it('a second document is unaffected by deletion of the first (isolation)', async () => {
    await wrenProperty(
      { number: 27, text: 'Document deletion partitions operational vs retained state' },
      fc.asyncProperty(
        scenarioArb,
        smallCountArb,
        smallCountArb,
        async (scenario, otherDrafts, otherFeedbackItems) => {
          const db = new FakeDb();
          await seedScenario(db, scenario);

          // Add a second document with its own state.
          const otherDocId = `other-${scenario.docId}`;
          db.seedDocument({ id: otherDocId, document_type_id: DT, owner_user_id: 'student-2' });
          for (let i = 0; i < otherDrafts; i++) {
            db.seedDraft({ id: `other-draft-${i}`, document_id: otherDocId });
          }
          for (let i = 0; i < otherFeedbackItems; i++) {
            db.seedFeedbackItem({ id: `other-fi-${i}`, document_id: otherDocId });
          }

          const actor = deptAdminContext([DEPT]);
          await deleteDocument(scenario.docId, true, actor, db);

          // The other document's state is untouched.
          if (!db.documents.has(otherDocId)) return false;
          const remainingDrafts = [...db.drafts.values()].filter((d) => d.document_id === otherDocId);
          if (remainingDrafts.length !== otherDrafts) return false;
          const remainingFi = [...db.feedbackItems.values()].filter((f) => f.document_id === otherDocId);
          return remainingFi.length === otherFeedbackItems;
        },
      ),
    );
  });
});
