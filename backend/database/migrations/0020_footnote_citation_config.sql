-- Migration 0020 — Add citation_config to document_type_config.
--
-- Additive-only column supporting the footnote/citation feature
-- (footnote-citation-support spec, Requirement 6). Stores a Department
-- Admin's per-Document-Type citation style + required-field configuration
-- as JSONB, validated at the application layer by `citationConfigSchema`
-- (@wren/types) — mirrors the existing `category_priority` jsonb-with-
-- app-level-validation pattern already on this table.
--
-- Footnote data itself requires NO schema change: it lives entirely inside
-- the existing `draft.content` jsonb column (added in migration
-- 0013_draft_tiptap_content.sql) as `footnote` TipTap nodes.
--
-- Safety (Requirement 6.1, 6.3, 6.5, 6.6):
--   - Single ALTER TABLE ... ADD COLUMN IF NOT EXISTS statement.
--   - No DEFAULT, no NOT NULL, no CHECK constraint.
--   - No UPDATE/DELETE/INSERT on existing rows.
--   - On PostgreSQL 11+, ADD COLUMN with no DEFAULT is a metadata-only
--     change — it does not rewrite existing rows or hold a long-lived
--     ACCESS EXCLUSIVE lock.
--
-- Idempotent (Requirement 6.4): IF NOT EXISTS makes re-execution a no-op.
-- Existing rows read `citation_config` as NULL, which every read path
-- (toDocumentTypeConfig, extractFootnotes, tipTapContentToSegments)
-- already treats as "no config" / "zero footnotes" (Requirement 6.2).

ALTER TABLE document_type_config
    ADD COLUMN IF NOT EXISTS citation_config jsonb;
