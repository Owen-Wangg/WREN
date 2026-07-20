-- Migration 0007 — Department-level prompt + extra document type config prompt fields.
--
-- 1. department.prompt: a TechnicalAdmin-authored instruction text applied
--    across all document types for the department.
-- 2. document_type_config: three additional DeptAdmin-authored prompt sections
--    (structure, restrictions, notes) that sit alongside the existing
--    type_prompt_text / tone_description / density_description fields.

BEGIN;

ALTER TABLE department
    ADD COLUMN IF NOT EXISTS prompt text;

ALTER TABLE document_type_config
    ADD COLUMN IF NOT EXISTS structure_description text,
    ADD COLUMN IF NOT EXISTS restrictions_description text,
    ADD COLUMN IF NOT EXISTS notes_description text;

COMMIT;
