-- ===========================================================================
-- 0002_authorizer_grants_repair.sql
--
-- Authorizer throttling remediation (Task 5): repair the wren_authorizer role's
-- table privileges.
--
-- WHY: On 2025-09-03 the authorizer hit Postgres 42501 (permission denied for
-- table app_user). The baseline (0001) grants these privileges, but a database
-- that had already recorded 0001_baseline.sql in schema_migrations does NOT
-- re-run the (later rewritten/squashed) baseline — so an environment created
-- before the grants were folded in can be missing them. This forward-only,
-- idempotent migration re-applies exactly the privileges the authorizer needs.
--
-- The authorizer's queries (confirmed against backend/auth/src):
--   * app_user       — SELECT + INSERT + UPDATE
--       identityMapping.ts:  SELECT id, email, idp_subject FROM app_user ...
--       provisionUser.ts:    INSERT INTO app_user ... ON CONFLICT DO UPDATE,
--                            and an email-relink UPDATE app_user ...
--       (PostgreSQL requires UPDATE to PLAN "ON CONFLICT DO UPDATE" even when
--        no conflict fires — hence UPDATE is mandatory, not optional.)
--   * role_assignment — SELECT + INSERT
--       identityMapping.ts:  SELECT role, scope FROM role_assignment ...
--       provisionUser.ts:    INSERT INTO role_assignment ... (Student bootstrap)
--   * access_grant    — SELECT
--       identityMapping.ts:  SELECT ... FROM access_grant WHERE ... revoked_at IS NULL
--
-- GRANT is idempotent in PostgreSQL, so re-running this migration is safe. The
-- role-existence guard keeps it safe even if roles were somehow not created.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_authorizer') THEN
    RAISE EXCEPTION
      'Role wren_authorizer does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

-- Baseline connectivity privileges (idempotent; re-assert in case they too were
-- missed on a pre-squash environment).
GRANT CONNECT ON DATABASE appdb TO wren_authorizer;
GRANT USAGE ON SCHEMA public TO wren_authorizer;

-- The exact table privileges the authorizer requires.
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_user TO wren_authorizer;
GRANT SELECT, INSERT ON TABLE public.role_assignment TO wren_authorizer;
GRANT SELECT ON TABLE public.access_grant TO wren_authorizer;
