-- Migration 0031 — One helpfulness rating per (document, draft).
--
-- Students could insert unlimited anonymous rows by varying draftId. Mirror
-- debrief_section_applicability: unique on (document_id, draft_id) so the
-- handler can upsert. No user_id column — anonymity is preserved.
-- Postgres UNIQUE allows multiple NULLs, so historical null-draft rows are
-- left in place; the handler now requires a real draft id.

BEGIN;

DELETE FROM feedback_helpfulness_rating a
USING feedback_helpfulness_rating b
WHERE a.document_id = b.document_id
  AND a.draft_id = b.draft_id
  AND a.draft_id IS NOT NULL
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id < b.id)
  );

ALTER TABLE feedback_helpfulness_rating
    ADD CONSTRAINT uq_feedback_helpfulness_document_draft
    UNIQUE (document_id, draft_id);

COMMIT;
