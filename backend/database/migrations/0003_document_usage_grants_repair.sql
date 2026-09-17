-- ===========================================================================
-- 0003_document_usage_grants_repair.sql
--
-- Document upload remediation: grant the wren_document role the privileges it
-- needs on public.user_lifetime_usage.
--
-- WHY: Uploading a document for review hit Postgres 42501 (permission denied
-- for table user_lifetime_usage). The document service enforces the per-user
-- lifetime upload cap in backend/admin/src/lifetimeUsagePolicy.ts, which the
-- Document Lambda (role: wren_document) runs on every upload:
--
--   * SELECT document_upload_count FROM user_lifetime_usage WHERE user_id = $1
--   * INSERT INTO user_lifetime_usage (user_id, document_upload_count)
--       ... ON CONFLICT (user_id) DO UPDATE
--       SET document_upload_count = user_lifetime_usage.document_upload_count + 1
--       ... RETURNING document_upload_count
--
-- The baseline (0001) grants wren_document its other tables but omits
-- user_lifetime_usage entirely, so the role has no access to it. The
-- ON CONFLICT DO UPDATE requires UPDATE (PostgreSQL must plan the DO UPDATE
-- branch even when no conflict fires), the INSERT requires INSERT, and the
-- SELECT/RETURNING/WHERE reads require SELECT — hence SELECT, INSERT, UPDATE.
--
-- Like 0002, this is forward-only and idempotent (GRANT is idempotent in
-- PostgreSQL), and it fixes both existing environments (which will not re-run
-- the squashed baseline) and fresh deploys (which apply it in order). The
-- role-existence guard keeps it safe even if the role was somehow not created.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_document') THEN
    RAISE EXCEPTION
      'Role wren_document does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

-- Baseline connectivity privileges (idempotent; re-assert in case they too were
-- missed on a pre-squash environment).
GRANT CONNECT ON DATABASE appdb TO wren_document;
GRANT USAGE ON SCHEMA public TO wren_document;

-- The exact table privileges the document upload path requires.
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_lifetime_usage TO wren_document;
