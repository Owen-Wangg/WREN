-- ===========================================================================
-- 0012_retighten_admin_student_work_grants.sql
--
-- Re-tighten wren_admin's access to the student-work tables (SECURITY_MISCONFIGURATION).
--
-- WHY: wren_admin is the DB role the Admin Lambda (dozens of internet-reachable
-- routes) runs as. It needs counts / joins / aggregates over the student-work
-- tables, but it must never read the student prose (draft.segments / content /
-- header / footer), the generated feedback text (feedback_item.question_text /
-- quoted_text / positive_note), or document titles (document.name). With no RLS,
-- the column-level SELECT grants are the only DB-side backstop.
--
-- That retightening -- replacing wren_admin's table-level SELECT on document,
-- draft and feedback_item with column-level SELECT -- was folded into the
-- squashed baseline (0001). But a database that had already recorded
-- 0001_baseline.sql in schema_migrations does NOT re-run the rewritten file, so
-- environments provisioned before the fold-in still grant wren_admin whole-table
-- SELECT and can read every column, including the sensitive prose. Like 0002,
-- 0003, 0006 and 0011, this is a forward-only, idempotent repair that converges
-- existing databases and is a harmless no-op on fresh deploys (which already
-- received the column-level grants from the baseline).
--
-- Mechanics: in PostgreSQL whole-table and column-level SELECT are tracked
-- independently. REVOKE SELECT ON TABLE removes only the whole-table privilege
-- and leaves column grants intact; GRANT SELECT (cols) (re-)asserts the
-- column-level privilege. So revoking the table grant and re-issuing the column
-- grants converges an old database to exactly the baseline state, and on a fresh
-- database the REVOKE is a no-op (table SELECT was never granted) and the GRANTs
-- are identical to what the baseline already applied.
--
-- Every statement is idempotent:
--   * REVOKE                 -- no-op if the whole-table privilege isn't held
--   * GRANT SELECT (cols)    -- idempotent in PostgreSQL
-- The role-existence guard keeps it safe even if the role was somehow not created.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_admin') THEN
    RAISE EXCEPTION
      'Role wren_admin does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

-- 1. Drop the over-broad whole-table SELECT on the student-work tables.
--    (Column-level grants, if present, are untouched by these REVOKEs.)
REVOKE SELECT ON TABLE public.document FROM wren_admin;
REVOKE SELECT ON TABLE public.draft FROM wren_admin;
REVOKE SELECT ON TABLE public.feedback_item FROM wren_admin;

-- 2. Re-assert exactly the column-level SELECT the Admin Lambda needs for
--    counts / joins / aggregates -- never the student prose, generated feedback
--    text, or document titles. These mirror the baseline grants verbatim.
--    COUNT(*) only needs SELECT on one column, so counts still work.
GRANT SELECT (id, owner_user_id, document_type_id, content_type_id, metadata,
              status, created_at, debrief_generation_count, draft_create_count)
  ON public.document TO wren_admin;
GRANT SELECT (id, document_id, version_number, word_count, created_at)
  ON public.draft TO wren_admin;
GRANT SELECT (id, document_id, error_category_id, kind, source_draft_id, created_at)
  ON public.feedback_item TO wren_admin;
