BEGIN;

-- Department-level Ask WREN prompt (department-configurable coaching context).
--
-- Adds a nullable `ask_wren_prompt` column to `department`, mirroring the
-- existing `prompt` column but reserved for the Ask WREN Socratic-chat path.
-- It is intentionally SEPARATE from `department.prompt` (which feeds the Python
-- Feedback Engine): the two prompt surfaces are edited and consumed
-- independently. NULL means "no department Ask WREN layer" — Ask WREN behaves
-- exactly as before, using only the universal system prompt plus document-type
-- context. No backfill is required.
ALTER TABLE public.department
  ADD COLUMN IF NOT EXISTS ask_wren_prompt text;

COMMIT;
