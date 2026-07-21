-- Migration 0008 — Add quoted_text to feedback_item.
--
-- Stores the verbatim text span the AI cited, extracted from the document
-- segment at insert time using the anchor offsets. Shown as a blockquote in
-- the AI Debrief sidebar so students can see exactly what passage the
-- feedback refers to before clicking to highlight it in the editor.

BEGIN;

ALTER TABLE feedback_item
    ADD COLUMN IF NOT EXISTS quoted_text text;

COMMIT;
