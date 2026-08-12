-- Migration 0026 — Add ocr_confidence to draft.
--
-- Stores the arithmetic mean of all OCR line confidence scores (0.00–100.00)
-- for scanned PDF reconstructions (scanned-pdf-reconstruction spec,
-- Requirement 7.6). Allows downstream filtering or display of overall
-- document quality after Textract ingestion.
--
-- Safety:
--   - Single ALTER TABLE ... ADD COLUMN IF NOT EXISTS statement.
--   - No DEFAULT, no NOT NULL, no CHECK constraint.
--   - No UPDATE/DELETE/INSERT on existing rows.
--   - On PostgreSQL 11+, ADD COLUMN with no DEFAULT is a metadata-only
--     change — it does not rewrite existing rows or hold a long-lived
--     ACCESS EXCLUSIVE lock.
--
-- Idempotent: IF NOT EXISTS makes re-execution a no-op.
-- Existing rows read `ocr_confidence` as NULL, which the application layer
-- treats as "not a scanned PDF" or "confidence not computed."

ALTER TABLE draft
    ADD COLUMN IF NOT EXISTS ocr_confidence numeric(5,2);
