-- Migration 0015 — Add soft-delete support to the department table.
--
-- archived_at IS NULL  →  active (default, all existing rows)
-- archived_at IS NOT NULL  →  archived (invisible to students, no new submissions)
--
-- Archiving preserves all child data (document types, documents, feedback) so
-- student work is never lost when a department is retired.

ALTER TABLE department
    ADD COLUMN archived_at timestamptz;
