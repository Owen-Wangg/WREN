-- Migration 0035 — Admin-configurable maximum upload file size.
--
-- Adds max_upload_file_size_bytes to the single-row platform_usage_policy table
-- so TechnicalAdmin can change the limit without a redeploy.
-- Default: 30 MB.  Floor: 1 MB.  Ceiling: 1 GB.

BEGIN;

ALTER TABLE platform_usage_policy
    ADD COLUMN IF NOT EXISTS max_upload_file_size_bytes bigint NOT NULL DEFAULT 31457280
        CHECK (max_upload_file_size_bytes >= 1048576 AND max_upload_file_size_bytes <= 1073741824);

COMMIT;
