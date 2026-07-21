-- Migration 0009 — Add feedback_helpfulness_rating table.
--
-- Stores voluntary helpfulness ratings submitted by Students after receiving
-- an AI Debrief (Requirement 16.1–16.5). Used exclusively for aggregate,
-- anonymized analytics visible to DepartmentAdmins and TechnicalAdmins —
-- never exposed back to the Student who submitted it.
--
-- Privacy design:
--   - No user_id column: ratings are anonymous at the storage layer; the
--     submission Lambda knows who sent it (for auth) but does NOT persist
--     that identity (Requirement 43.2 — aggregate analytics must not leak
--     per-Student operational state).
--   - ON DELETE CASCADE from document: if a Student deletes their Document,
--     their ratings go with it (Requirement 43.4 — per-Student state is
--     deleted with its Document). Because there is no user_id column, the
--     cascade is the only linkage that could identify a rating's owner, and
--     after the delete that linkage is gone.
--   - document_type_id is denormalized (also on document) so admin analytics
--     queries can filter by document type without joining through document,
--     which could inadvertently expose per-Student document metadata.

BEGIN;

CREATE TABLE feedback_helpfulness_rating (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id      uuid        NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    draft_id         uuid,
    document_type_id uuid        NOT NULL REFERENCES document_type(id),
    helpful          boolean     NOT NULL,
    comment          text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Admin analytics query pattern: WHERE document_type_id = $1 ORDER BY created_at DESC
CREATE INDEX idx_helpfulness_rating_document_type
    ON feedback_helpfulness_rating (document_type_id, created_at DESC);

COMMIT;
