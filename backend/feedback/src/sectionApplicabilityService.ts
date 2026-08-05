/**
 * Pure service functions for debrief section applicability votes.
 *
 * Extracted from lambda-handler to be unit-testable with a FakeDb without
 * spinning up RDS or mocking the entire @wren/db-node module.
 */
import type { QueryExecutor } from './db.js';

export interface SectionApplicabilityRow {
  error_category_id: string;
  applicable: boolean;
}

/**
 * Upsert an applicable/not-applicable vote for one debrief section.
 * Returns the stored vote for the caller to echo back.
 */
export async function upsertSectionApplicability(
  db: QueryExecutor,
  documentId: string,
  draftId: string,
  errorCategoryId: string,
  applicable: boolean,
): Promise<void> {
  await db.query(
    `INSERT INTO debrief_section_applicability (document_id, draft_id, error_category_id, applicable)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, draft_id, error_category_id)
     DO UPDATE SET applicable = EXCLUDED.applicable, updated_at = now()`,
    [documentId, draftId, errorCategoryId, applicable],
  );
}

/**
 * Fetch all applicability votes for a given document + draft.
 * Returns a map of errorCategoryId → applicable.
 */
export async function getSectionApplicabilityVotes(
  db: QueryExecutor,
  documentId: string,
  draftId: string,
): Promise<Record<string, boolean>> {
  const rows = await db.query<SectionApplicabilityRow>(
    `SELECT error_category_id, applicable
     FROM debrief_section_applicability
     WHERE document_id = $1 AND draft_id = $2`,
    [documentId, draftId],
  );
  const votes: Record<string, boolean> = {};
  for (const row of rows) {
    votes[row.error_category_id] = row.applicable;
  }
  return votes;
}
