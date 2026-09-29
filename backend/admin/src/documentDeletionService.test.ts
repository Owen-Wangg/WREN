/**
 * Unit tests for document-deletion retention partitioning
 * (REQ-AUDIT-RETENTION-01 / Requirement 45; Task 14.5).
 *
 * Verifies:
 *   - Deletion cascades to per-Student operational state (Drafts, Anchors,
 *     Feedback Items, Resolution Status History) — Requirement 45.1.
 *   - Activity-log events and aggregate counters survive deletion —
 *     Requirement 45.4.
 *   - Confirmation is required before deletion (describes permanent impact)
 *     — Requirement 45.3.
 *   - NotFoundError for unknown documents.
 */
import { FakeDb } from './fakeDb';
import { deptAdminContext } from './testContexts';
import {
  deleteDocument,
  getDocumentDeletionImpact,
} from './documentDeletionService';
import { recordActivityEvent, setPseudonymSaltLoader } from './activityLogService';
import { NotFoundError } from './errors';

beforeAll(() => { setPseudonymSaltLoader(async () => 'test-salt-deletion'); });
afterAll(() => { setPseudonymSaltLoader(undefined); });

const DEPT = 'dept-1';
const DT = 'dt-1';
const DOC = 'doc-1';

function seedFullDocument(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
  db.seedDocument({ id: DOC, document_type_id: DT, owner_user_id: 'student-1' });

  // Two drafts.
  db.seedDraft({ id: 'draft-1', document_id: DOC, version_number: 1 });
  db.seedDraft({ id: 'draft-2', document_id: DOC, version_number: 2 });

  // Three feedback items.
  db.seedFeedbackItem({ id: 'fi-1', document_id: DOC, kind: 'inline', question_text: 'Why this?' });
  db.seedFeedbackItem({ id: 'fi-2', document_id: DOC, kind: 'inline', question_text: 'Clarify?' });
  db.seedFeedbackItem({ id: 'fi-3', document_id: DOC, kind: 'structural', question_text: 'Structure?' });

  // Anchors (attached to drafts).
  db.seedAnchor({ id: 'anc-1', draft_id: 'draft-1', feedback_item_id: 'fi-1' });
  db.seedAnchor({ id: 'anc-2', draft_id: 'draft-2', feedback_item_id: 'fi-2' });

  // Resolution status history entries.
  db.seedResolutionStatusHistory({ id: 'rsh-1', feedback_item_id: 'fi-1', draft_id: 'draft-2', status: 'resolved' });
  db.seedResolutionStatusHistory({ id: 'rsh-2', feedback_item_id: 'fi-2', draft_id: 'draft-2', status: 'still_unresolved' });
}

describe('getDocumentDeletionImpact', () => {
  it('returns the correct impact counts', async () => {
    const db = new FakeDb();
    seedFullDocument(db);

    const impact = await getDocumentDeletionImpact(DOC, db);

    expect(impact).toEqual({
      documentId: DOC,
      draftCount: 2,
      feedbackItemCount: 3,
      anchorCount: 2,
      resolutionEntryCount: 2,
    });
  });

  it('throws NotFoundError for an unknown document', async () => {
    const db = new FakeDb();
    seedFullDocument(db);

    await expect(getDocumentDeletionImpact('nonexistent', db)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('deleteDocument — confirmation requirement (Requirement 45.3)', () => {
  it('throws a descriptive error when confirmed is false', async () => {
    const db = new FakeDb();
    seedFullDocument(db);
    const actor = deptAdminContext([DEPT]);

    await expect(deleteDocument(DOC, false, actor, db)).rejects.toThrow(/confirmation/i);
    await expect(deleteDocument(DOC, false, actor, db)).rejects.toThrow(/permanently remove/i);
  });

  it('performs no deletion when confirmed is false', async () => {
    const db = new FakeDb();
    seedFullDocument(db);
    const actor = deptAdminContext([DEPT]);

    try { await deleteDocument(DOC, false, actor, db); } catch { /* expected */ }

    expect(db.documents.size).toBe(1);
    expect(db.drafts.size).toBe(2);
    expect(db.feedbackItems.size).toBe(3);
    expect(db.anchors.size).toBe(2);
    expect(db.resolutionStatusHistory.size).toBe(2);
  });
});

describe('deleteDocument — cascade of per-Student operational state (Requirement 45.1, 39.3)', () => {
  it('removes the document, all drafts, feedback items, anchors, and resolution history', async () => {
    const db = new FakeDb();
    seedFullDocument(db);
    const actor = deptAdminContext([DEPT]);

    const receipt = await deleteDocument(DOC, true, actor, db);

    expect(receipt.documentId).toBe(DOC);
    expect(receipt.deletedDrafts).toBe(2);
    expect(receipt.deletedFeedbackItems).toBe(3);
    expect(receipt.deletedAnchors).toBe(2);
    expect(receipt.deletedResolutionEntries).toBe(2);

    // All operational state is gone.
    expect(db.documents.size).toBe(0);
    expect(db.drafts.size).toBe(0);
    expect(db.feedbackItems.size).toBe(0);
    expect(db.anchors.size).toBe(0);
    expect(db.resolutionStatusHistory.size).toBe(0);
  });

  it('throws NotFoundError for an unknown document (even when confirmed)', async () => {
    const db = new FakeDb();
    seedFullDocument(db);

    await expect(deleteDocument('missing', true, deptAdminContext([DEPT]), db))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('deleteDocument — activity-log events and aggregate counters are RETAINED (Requirement 45.4, 44.2, 43.4)', () => {
  it('activity-log events derived from the document survive deletion', async () => {
    const db = new FakeDb();
    seedFullDocument(db);
    const actor = deptAdminContext([DEPT]);

    // Record some activity events about this document.
    await recordActivityEvent({
      actorUserId: 'student-1',
      verb: 'uploaded',
      objectType: 'Document',
      objectRef: DOC,
      documentTypeId: DT,
    }, db);
    await recordActivityEvent({
      actorUserId: 'student-1',
      verb: 'requested',
      objectType: 'AiDebrief',
      objectRef: DOC,
      documentTypeId: DT,
    }, db);

    expect(db.activityEvents).toHaveLength(2);

    const receipt = await deleteDocument(DOC, true, actor, db);

    // Activity events survive — they are independent of document content.
    expect(db.activityEvents).toHaveLength(2);
    expect(receipt.retainedActivityEvents).toBe(1); // Only the 'Document' objectType ones are counted.
  });

  it('aggregate counters are untouched by document deletion', async () => {
    const db = new FakeDb();
    seedFullDocument(db);
    const actor = deptAdminContext([DEPT]);

    db.seedAggregateCounter({
      id: 'agg-1',
      scope_kind: 'documentType',
      scope_id: DT,
      metric: 'feedback_requested_count',
      window_start: new Date('2026-01-01T00:00:00.000Z'),
      value: 42,
    });
    db.seedAggregateCounter({
      id: 'agg-2',
      scope_kind: 'platform',
      scope_id: null,
      metric: 'submissions_count',
      window_start: new Date('2026-01-01T00:00:00.000Z'),
      value: 100,
    });

    await deleteDocument(DOC, true, actor, db);

    expect(db.aggregateCounters.size).toBe(2);
    expect(db.aggregateCounters.get('agg-1')?.value).toBe(42);
    expect(db.aggregateCounters.get('agg-2')?.value).toBe(100);
  });

  it('does not delete documents belonging to other users (isolation)', async () => {
    const db = new FakeDb();
    seedFullDocument(db);
    const actor = deptAdminContext([DEPT]);

    // Seed a second document.
    db.seedDocument({ id: 'doc-2', document_type_id: DT, owner_user_id: 'student-2' });
    db.seedDraft({ id: 'draft-3', document_id: 'doc-2', version_number: 1 });
    db.seedFeedbackItem({ id: 'fi-4', document_id: 'doc-2' });

    await deleteDocument(DOC, true, actor, db);

    // First document is gone; second is untouched.
    expect(db.documents.has(DOC)).toBe(false);
    expect(db.documents.has('doc-2')).toBe(true);
    expect(db.drafts.has('draft-3')).toBe(true);
    expect(db.feedbackItems.has('fi-4')).toBe(true);
  });
});
