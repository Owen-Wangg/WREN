-- ===========================================================================
-- 0007_authorizer_identity_relink_audit_grants.sql
--
-- First-login identity-relink hardening (security finding f-4531f8e7): give
-- the wren_authorizer role exactly what the hardened ensureAppUser needs.
--
-- WHY: first-login provisioning could relink an existing app_user (and all its
-- roles) to a new Cognito subject on an unverified email match. The fix
-- (backend/auth/src/provisionUser.ts) now:
--
--   * refuses to relink any row holding more than a plain Student role,
--     including an active department visibility grant. The pre-check and the
--     guarded UPDATE both evaluate
--       EXISTS (SELECT 1 FROM department_visibility_grant
--               WHERE user_id = $1 AND revoked_at IS NULL)
--     so the role needs SELECT on department_visibility_grant (it already has
--     SELECT on role_assignment and access_grant);
--   * records every successful relink as an `identity.relinked` activity_event
--     in the same transaction, through the shared INSERT-only writer
--     (appendActivityEventRow):
--       INSERT INTO activity_event (...) VALUES (...)      -- no RETURNING
--     so the role needs INSERT only. It is deliberately NOT granted SELECT:
--     the authorizer runs on every request and has no reason to read the
--     activity log. activity_event stays append-only: no UPDATE/DELETE is
--     granted, and the reject_activity_event_mutation trigger (0006) applies.
--
-- Forward-only and idempotent (GRANT is idempotent in PostgreSQL). The
-- role-existence guard fails loudly if the baseline never ran.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_authorizer') THEN
    RAISE EXCEPTION
      'Role wren_authorizer does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

GRANT CONNECT ON DATABASE appdb TO wren_authorizer;
GRANT USAGE ON SCHEMA public TO wren_authorizer;

-- Privilege check before an email relink (read-only).
GRANT SELECT ON TABLE public.department_visibility_grant TO wren_authorizer;

-- Durable relink audit record: write-only, append-only.
GRANT INSERT ON TABLE public.activity_event TO wren_authorizer;
