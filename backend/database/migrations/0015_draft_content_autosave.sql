-- Migration 0015 — Allow content-only updates on draft rows for autosave.
--
-- Draft identity, versioning, S3 key, and segments remain immutable (Requirement
-- 8.1). Autosave may update TipTap `content` and `word_count` on the current
-- draft without creating a new version (avoids burning drafts_per_document_limit).

BEGIN;

CREATE OR REPLACE FUNCTION reject_draft_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.s3_key IS DISTINCT FROM OLD.s3_key
       OR NEW.segments IS DISTINCT FROM OLD.segments
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION
            'Draft rows are immutable (id=%); only content/word_count may be updated for autosave.',
            OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
