-- Migration 0020 — Track when draft content was last autosaved.
--
-- Adds content_updated_at to draft so the PDF date-field can reflect the
-- actual last-edited time rather than the draft creation time.
-- NULL means the content has never been autosaved (legacy rows).

BEGIN;

ALTER TABLE draft
    ADD COLUMN IF NOT EXISTS content_updated_at timestamptz;

COMMIT;
