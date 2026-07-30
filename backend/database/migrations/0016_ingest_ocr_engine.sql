-- Migration 0016 — OCR engine selection + optional side-by-side comparison payload.

BEGIN;

ALTER TABLE document_ingest_job
    ADD COLUMN IF NOT EXISTS ocr_engine text NOT NULL DEFAULT 'tesseract',
    ADD COLUMN IF NOT EXISTS comparison jsonb;

COMMIT;
