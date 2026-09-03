BEGIN;

ALTER TABLE public.department
  ADD COLUMN IF NOT EXISTS visibility_state text NOT NULL DEFAULT 'VISIBLE';

DO $$ BEGIN
  ALTER TABLE public.department
    ADD CONSTRAINT department_visibility_state_check
    CHECK (visibility_state IN ('VISIBLE', 'PERMITTED_ONLY'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.department_visibility_grant (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES public.department(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT department_visibility_grant_revocation_check
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_department_visibility_grant_active
  ON public.department_visibility_grant (department_id, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_department_visibility_grant_user_active
  ON public.department_visibility_grant (user_id, department_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_department_visibility_grant_department_active
  ON public.department_visibility_grant (department_id, granted_at, id)
  WHERE revoked_at IS NULL;

COMMIT;
