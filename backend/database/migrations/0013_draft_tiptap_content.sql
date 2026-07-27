-- Migration 0013 — Persist TipTap rich content alongside plain segments.
--
-- draft.segments remains the AI / anchoring / diff substrate (plain text).
-- draft.content stores TipTap JSONContent so bold/italic/lists/tables survive
-- reload. NULL means legacy plain-only drafts (load via segments).

BEGIN;

ALTER TABLE draft
    ADD COLUMN IF NOT EXISTS content jsonb;

COMMIT;
