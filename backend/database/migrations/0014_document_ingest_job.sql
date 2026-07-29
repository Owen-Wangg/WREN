-- Migration 0014 — Async PDF ingest jobs (API Gateway ~29s vs OCR timeout).
--
-- Drafts remain immutable. PDF OCR/LiteParse runs in a background SQS worker that
-- creates a new Draft when extraction finishes. Clients poll ingest status.

CREATE TABLE document_ingest_job (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id    uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    s3_key         text NOT NULL,
    file_name      text NOT NULL,
    status         text NOT NULL
                   CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    error_message  text,
    draft_id       uuid REFERENCES draft(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_ingest_job_document
    ON document_ingest_job(document_id, created_at DESC);

CREATE INDEX idx_document_ingest_job_status
    ON document_ingest_job(status)
    WHERE status IN ('queued', 'processing');
