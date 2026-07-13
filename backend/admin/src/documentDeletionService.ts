/**
 * Document-deletion retention partitioning (REQ-AUDIT-RETENTION-01 /
 * Requirement 45; REQ-SEC-PII-01 criterion 3; REQ-AUDIT-OPSTATE-01
 * criterion 4; Task 14.5).
 *
 * Implements the design's correctness property: deleting a Document removes
 * ALL of its per-Student operational state (Drafts, Anchors, Feedback Items,
 * and Resolution Status History) while RETAINING the activity-log events and
 * aggregate analytics counters derived from it (Requirement 45.1, 45.4,
 * 44.2, 43.4, 39.3).
 *
 * The cascade is:
 *   Document → Draft(s) → Anchor(s) → ResolutionStatusHistory
 *                       → FeedbackItem(s) (via documentId)
 *
 * Activity-log events (`activity_event`) and aggregate counters
 * (`aggregate_counter`) are independent tables with NO foreign key to
 * `document`/`draft`/`feedback_item` — so deleting a Document cannot cascade
 * to them even in Postgres (this module makes that independence explicit for
 * tests and code readers).
 *
 * {@link deleteDocument} enforces:
 *   1. Confirmation requirement (Requirement 45.3): callers must supply
 *      `confirmed: true`, otherwise the call fails with an error describing
 *      the permanent impact.
 *   2. Cascade deletion of operational state (Requirement 45.1, 39.3).
 *   3. Retention of activity-log events and aggregate counters (Requirement
 *      45.4, 44.2, 43.4).
 */
import type { AuthContext } from '@wren/types';

import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Summary of what was deleted, returned to the caller. */
export interface DeletionReceipt {
  readonly documentId: string;
  readonly deletedDrafts: number;
  readonly deletedFeedbackItems: number;
  readonly deletedAnchors: number;
  readonly deletedResolutionEntries: number;
  /** Activity-log events remain intact — stated explicitly for transparency. */
  readonly retainedActivityEvents: number;
}

/** Confirm the Document exists and return its owner info (for authorization). */
async function findDocument(
  documentId: string,
  db: QueryExecutor,
): Promise<{ id: string; document_type_id: string; owner_user_id: string } | null> {
  const rows = await db.query<{ id: string; document_type_id: string; owner_user_id: string }>(
    'SELECT id, document_type_id, owner_user_id FROM document WHERE id = $1',
    [documentId],
  );
  return rows[0] ?? null;
}

/**
 * Get a deletion-impact report before actually deleting, so the caller can
 * present the confirmation prompt (Requirement 45.3 — "describe that attached
 * feedback will be permanently removed").
 */
export async function getDocumentDeletionImpact(
  documentId: string,
  db: QueryExecutor,
): Promise<{
  documentId: string;
  draftCount: number;
  feedbackItemCount: number;
  anchorCount: number;
  resolutionEntryCount: number;
}> {
  const doc = await findDocument(documentId, db);
  if (!doc) {
    throw new NotFoundError(`Document '${documentId}' not found`);
  }

  const drafts = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM draft WHERE document_id = $1',
    [documentId],
  );
  const feedbackItems = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM feedback_item WHERE document_id = $1',
    [documentId],
  );
  const anchors = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM anchor WHERE draft_id IN (SELECT id FROM draft WHERE document_id = $1)',
    [documentId],
  );
  const resolutionEntries = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM resolution_status_history WHERE feedback_item_id IN (SELECT id FROM feedback_item WHERE document_id = $1)',
    [documentId],
  );

  return {
    documentId,
    draftCount: drafts[0]?.count ?? 0,
    feedbackItemCount: feedbackItems[0]?.count ?? 0,
    anchorCount: anchors[0]?.count ?? 0,
    resolutionEntryCount: resolutionEntries[0]?.count ?? 0,
  };
}

/**
 * Delete a Document and cascade to all per-Student operational state while
 * retaining activity-log events and aggregate counters.
 *
 * @param confirmed — Must be `true` to proceed; `false` causes a descriptive
 *   error (Requirement 45.3).
 */
export async function deleteDocument(
  documentId: string,
  confirmed: boolean,
  _actor: AuthContext,
  db: QueryExecutor,
): Promise<DeletionReceipt> {
  if (!confirmed) {
    throw new Error(
      `Document deletion requires explicit confirmation. ` +
        `Deleting document '${documentId}' will permanently remove ALL attached ` +
        `Drafts, Feedback Items, Anchors, and resolution history. ` +
        `Activity-log events and aggregate analytics will be retained.`,
    );
  }

  const doc = await findDocument(documentId, db);
  if (!doc) {
    throw new NotFoundError(`Document '${documentId}' not found`);
  }

  // Count the activity-log events that will be RETAINED (for the receipt).
  const retainedEvents = await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM activity_event WHERE object_ref = $1 AND object_type = 'Document'",
    [documentId],
  );

  // Cascade delete in dependency order:
  //   resolution_status_history → anchor → feedback_item → draft → document
  const deletedResolution = await db.query<{ count: number }>(
    'DELETE FROM resolution_status_history WHERE feedback_item_id IN (SELECT id FROM feedback_item WHERE document_id = $1) RETURNING 1 AS count',
    [documentId],
  );
  const deletedAnchors = await db.query<{ count: number }>(
    'DELETE FROM anchor WHERE draft_id IN (SELECT id FROM draft WHERE document_id = $1) RETURNING 1 AS count',
    [documentId],
  );
  const deletedFeedbackItems = await db.query<{ count: number }>(
    'DELETE FROM feedback_item WHERE document_id = $1 RETURNING 1 AS count',
    [documentId],
  );
  const deletedDrafts = await db.query<{ count: number }>(
    'DELETE FROM draft WHERE document_id = $1 RETURNING 1 AS count',
    [documentId],
  );
  await db.query('DELETE FROM document WHERE id = $1', [documentId]);

  return {
    documentId,
    deletedDrafts: deletedDrafts.length,
    deletedFeedbackItems: deletedFeedbackItems.length,
    deletedAnchors: deletedAnchors.length,
    deletedResolutionEntries: deletedResolution.length,
    retainedActivityEvents: retainedEvents[0]?.count ?? 0,
  };
}
