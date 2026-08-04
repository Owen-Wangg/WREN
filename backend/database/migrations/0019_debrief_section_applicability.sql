-- Migration 0019 — Add debrief_section_applicability table.
--
-- Stores per-student, per-section applicable/not-applicable votes on AI
-- Debrief categories (Requirement 16 series extension). Keyed by
-- (document_id, draft_id, error_category_id) with upsert semantics so
-- toggling replaces the previous vote.
--
-- Privacy design (mirrors feedback_helpfulness_rating migration 0009):
--   - No user_id column: votes are anonymous at the storage layer; the
--     submitting Lambda knows who sent it (for auth) but does NOT persist
--     identity. Cascade from document ensures cleanup when a student
--     deletes their document.
--   - draft_id is NOT NULL here (unlike helpfulness_rating) because
--     applicability is meaningful only against a specific debrief generation
--     — a later regeneration may change the feedback, so old votes should
--     not carry over.

BEGIN;

CREATE TABLE debrief_section_applicability (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id        uuid        NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    draft_id           uuid        NOT NULL,
    error_category_id  uuid        NOT NULL REFERENCES error_category(id) ON DELETE CASCADE,
    applicable         boolean     NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_section_applicability UNIQUE (document_id, draft_id, error_category_id)
);

-- Fast lookup for fetching all votes for a given debrief (document + draft).
CREATE INDEX idx_section_applicability_debrief
    ON debrief_section_applicability (document_id, draft_id);

COMMIT;
