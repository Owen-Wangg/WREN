-- ===========================================================================
-- 0009_technical_admin_bootstrap_marker.sql
--
-- One-shot marker for the first-admin TechnicalAdmin bootstrap.
--
-- The authorizer may grant TechnicalAdmin to the operator-armed Cognito subject
-- on that subject's authenticated application request. This table records that
-- the grant has already happened, keyed by the IdP subject. Both bootstrap grant
-- paths (first-login provisioning and the authorizer re-elevation path) consult
-- it first and skip the grant when a row is present, so the elevation runs at
-- most once per subject and a later role revocation is never undone.
--
-- The marker is independent of role_assignment: deleting the role does not clear
-- the marker, so the bootstrap does not re-fire. The row is written in the same
-- transaction as the role_assignment INSERT and the role.assigned activity_event,
-- so grant, marker, and audit commit together.
--
-- Append-only one-shot: wren_authorizer receives SELECT + INSERT only (no
-- UPDATE/DELETE). Forward-only and idempotent (CREATE TABLE IF NOT EXISTS,
-- idempotent GRANT). The role-existence guard fails loudly if the baseline
-- never ran.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_authorizer') THEN
    RAISE EXCEPTION
      'Role wren_authorizer does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.technical_admin_bootstrap (
    idp_subject text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
    completed_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT CONNECT ON DATABASE appdb TO wren_authorizer;
GRANT USAGE ON SCHEMA public TO wren_authorizer;

-- One-shot bootstrap marker: read to decide whether the grant already ran,
-- insert once when it does. No UPDATE/DELETE — the marker is permanent.
GRANT SELECT, INSERT ON TABLE public.technical_admin_bootstrap TO wren_authorizer;
