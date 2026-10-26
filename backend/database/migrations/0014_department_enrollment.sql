-- ===========================================================================
-- 0014_department_enrollment.sql
--
-- Department roster import: a System Admin uploads a CSV of student emails to
-- enroll them in a Department in one step instead of granting each user
-- individually.
--
-- Enrolling a student means: an active department_visibility_grant for the
-- Department, plus an active access_grant for EVERY Document Type in it
-- (including Document Types created later). The roster row is keyed by email
-- because the student may not have an account yet:
--
--   * email already belongs to exactly one live account -> linked and granted
--     at import time;
--   * otherwise the row stays pending (user_id IS NULL) and is redeemed by the
--     authorizer right after first-login provisioning. Provisioning refuses an
--     unverified Cognito email, so a pending row can only ever be claimed by a
--     user who proved ownership of that address.
--
-- Pending emails are deliberately NOT materialized as placeholder app_user
-- rows: first-login provisioning refuses to relink any row holding an active
-- grant (provisionUser.ts, privileged_identity), so a pre-granted placeholder
-- would lock its owner out. Seed rows (`seed:` subjects) and case-variant
-- duplicate accounts are left pending for the same reason.
--
-- All grant writes go through ONE function, apply_department_enrollments(),
-- which is SECURITY DEFINER so the authorizer gets EXECUTE only — it is not
-- granted INSERT on access_grant or department_visibility_grant.
--
-- Forward-only and idempotent.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_admin')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_authorizer') THEN
    RAISE EXCEPTION
      'Roles wren_admin / wren_authorizer do not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.department_enrollment (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id uuid NOT NULL
    REFERENCES public.department(id) ON DELETE CASCADE,
  -- Stored lower-cased; matched against lower(app_user.email).
  email text NOT NULL,
  -- NULL until an account with this email exists (pending enrollment).
  user_id uuid
    REFERENCES public.app_user(id) ON DELETE SET NULL,
  invited_by uuid
    REFERENCES public.app_user(id) ON DELETE SET NULL,
  invited_at timestamp with time zone DEFAULT now() NOT NULL,
  linked_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT department_enrollment_email_normalized_check
    CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT department_enrollment_revocation_check
    CHECK (revoked_at IS NULL OR revoked_at >= invited_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_department_enrollment_active
  ON public.department_enrollment (department_id, email)
  WHERE revoked_at IS NULL;

-- Redemption on first sign-in looks up pending rows by email.
CREATE INDEX IF NOT EXISTS idx_department_enrollment_pending_email
  ON public.department_enrollment (email)
  WHERE revoked_at IS NULL AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_department_enrollment_user_active
  ON public.department_enrollment (user_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- apply_department_enrollments(department, user, emails)
--
-- Links pending roster rows to their account and issues the grants. Every
-- argument is an optional filter (NULL = no filter):
--   * admin import:      (department_id, NULL, imported_emails)
--   * first-login:       (NULL, new_user_id, NULL)
-- Scoping the admin call to the imported emails means an import never
-- re-issues a grant a Department Admin revoked for a student who was not in
-- this upload. Returns the number of roster rows newly linked to an account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_department_enrollments(
  p_department_id uuid,
  p_user_id uuid,
  p_emails text[]
) RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
  linked integer;
BEGIN
  UPDATE department_enrollment de
     SET user_id = u.id,
         linked_at = now()
    FROM app_user u
   WHERE de.user_id IS NULL
     AND de.revoked_at IS NULL
     AND (p_department_id IS NULL OR de.department_id = p_department_id)
     AND (p_emails IS NULL OR de.email = ANY (p_emails))
     AND (p_user_id IS NULL OR u.id = p_user_id)
     AND lower(u.email) = de.email
     AND u.idp_subject NOT LIKE 'seed:%'
     AND (SELECT count(*) FROM app_user u2 WHERE lower(u2.email) = de.email) = 1;
  GET DIAGNOSTICS linked = ROW_COUNT;

  INSERT INTO department_visibility_grant (department_id, user_id, granted_by)
  SELECT de.department_id, de.user_id, de.invited_by
    FROM department_enrollment de
   WHERE de.user_id IS NOT NULL
     AND de.revoked_at IS NULL
     AND (p_department_id IS NULL OR de.department_id = p_department_id)
     AND (p_emails IS NULL OR de.email = ANY (p_emails))
     AND (p_user_id IS NULL OR de.user_id = p_user_id)
  ON CONFLICT (department_id, user_id) WHERE revoked_at IS NULL DO NOTHING;

  INSERT INTO access_grant (user_id, document_type_id, granted_by)
  SELECT de.user_id, dt.id, de.invited_by
    FROM department_enrollment de
    JOIN document_type dt ON dt.department_id = de.department_id
   WHERE de.user_id IS NOT NULL
     AND de.revoked_at IS NULL
     AND (p_department_id IS NULL OR de.department_id = p_department_id)
     AND (p_emails IS NULL OR de.email = ANY (p_emails))
     AND (p_user_id IS NULL OR de.user_id = p_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM access_grant ag
        WHERE ag.user_id = de.user_id
          AND ag.document_type_id = dt.id
          AND ag.revoked_at IS NULL
     );

  RETURN linked;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_department_enrollments(uuid, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_department_enrollments(uuid, uuid, text[])
  TO wren_admin, wren_authorizer;

-- ---------------------------------------------------------------------------
-- New Document Types in a Department are granted to its linked enrollees, so
-- an enrolled student keeps access as the catalog grows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_department_enrollees_document_type()
  RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
  INSERT INTO access_grant (user_id, document_type_id, granted_by)
  SELECT de.user_id, NEW.id, de.invited_by
    FROM department_enrollment de
   WHERE de.department_id = NEW.department_id
     AND de.user_id IS NOT NULL
     AND de.revoked_at IS NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_department_enrollees_document_type() FROM PUBLIC;

DROP TRIGGER IF EXISTS document_type_enrollment_grants ON public.document_type;
CREATE TRIGGER document_type_enrollment_grants
  AFTER INSERT ON public.document_type
  FOR EACH ROW EXECUTE FUNCTION public.grant_department_enrollees_document_type();

-- wren_admin writes roster rows (import) and reads them for the result summary.
GRANT SELECT, INSERT, UPDATE ON TABLE public.department_enrollment TO wren_admin;
