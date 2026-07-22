-- Migration 0010 — Platform lifetime usage policy (System Admin configurable).
--
-- Single-row policy for lifetime caps applied to every user/department:
--   - Ask LEON user messages per document
--   - AI Debrief generations per document
--   - Documents owned per user
--   - Draft versions per document
--
-- document.debrief_generation_count tracks lifetime debrief regenerations
-- (feedback items are replaced on regenerate, so counting rows is incorrect).

BEGIN;

CREATE TABLE platform_usage_policy (
    id                          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    message_limit               integer NOT NULL DEFAULT 100
                                CHECK (message_limit >= 1),
    debrief_generation_limit    integer NOT NULL DEFAULT 15
                                CHECK (debrief_generation_limit >= 1),
    document_upload_limit       integer NOT NULL DEFAULT 30
                                CHECK (document_upload_limit >= 1),
    drafts_per_document_limit   integer NOT NULL DEFAULT 15
                                CHECK (drafts_per_document_limit >= 1),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_usage_policy (
    id,
    message_limit,
    debrief_generation_limit,
    document_upload_limit,
    drafts_per_document_limit
) VALUES (1, 100, 15, 30, 15);

ALTER TABLE document
    ADD COLUMN IF NOT EXISTS debrief_generation_count integer NOT NULL DEFAULT 0
        CHECK (debrief_generation_count >= 0);

COMMIT;
