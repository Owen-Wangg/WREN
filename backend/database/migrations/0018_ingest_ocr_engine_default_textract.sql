-- Migration: Change default OCR engine from 'tesseract' to 'textract'.
-- LiteParse/Tesseract has been removed; Textract is the sole OCR engine.

ALTER TABLE document_ingest_job
    ALTER COLUMN ocr_engine SET DEFAULT 'textract';
