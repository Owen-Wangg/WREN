-- Migration 0030 — Monotonic lifetime usage ledger.
--
-- Document-upload and draft-create quotas previously counted live rows
-- (COUNT(*) FROM document / draft). Deleting a document reset those counters
-- and concurrent requests raced. This migration:
--   1. user_lifetime_usage.document_upload_count — per-user, survives delete
--   2. document.draft_create_count — per-document, survives draft deletion
--      (same pattern as debrief_generation_count)
-- Existing rows are backfilled from current live counts so in-use quotas are
-- not reset.

BEGIN;

CREATE TABLE user_lifetime_usage (
    user_id                uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
    document_upload_count  integer NOT NULL DEFAULT 0
                           CHECK (document_upload_count >= 0)
);

INSERT INTO user_lifetime_usage (user_id, document_upload_count)
SELECT owner_user_id, COUNT(*)::int
FROM document
GROUP BY owner_user_id
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE document
    ADD COLUMN IF NOT EXISTS draft_create_count integer NOT NULL DEFAULT 0
        CHECK (draft_create_count >= 0);

UPDATE document d
SET draft_create_count = sub.cnt
FROM (
    SELECT document_id, COUNT(*)::int AS cnt
    FROM draft
    GROUP BY document_id
) sub
WHERE d.id = sub.document_id
  AND d.draft_create_count = 0;

GRANT SELECT, INSERT, UPDATE ON TABLE user_lifetime_usage TO wren_document;

COMMIT;
