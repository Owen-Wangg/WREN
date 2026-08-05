-- Migration 0021 — Store header and footer TipTap JSON on draft.
--
-- header and footer are autosaved alongside the body content.
-- NULL means no header/footer has been set (renders as blank on export).

BEGIN;

ALTER TABLE draft
    ADD COLUMN IF NOT EXISTS header jsonb,
    ADD COLUMN IF NOT EXISTS footer jsonb;

COMMIT;
