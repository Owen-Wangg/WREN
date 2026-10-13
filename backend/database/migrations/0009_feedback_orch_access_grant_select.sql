-- ===========================================================================
-- 0009_feedback_orch_access_grant_select.sql
--
-- Submission access gate remediation: give the wren_feedback_orch role the
-- read it needs to evaluate access grants.
--
-- WHY: the Feedback Orchestrator now calls checkSubmissionAccess
-- (backend/auth/src/submissionAccess.ts) before every paid operation —
-- POST /v1/documents/{documentId}/ask-wren and the debrief request path in
-- backend/feedback/src/lambda-handler.ts. That helper reads:
--     SELECT ... FROM document_type dt JOIN department d ...   -- already granted
--     SELECT ... FROM access_grant WHERE user_id = $1 AND document_type_id = $2
--                                    AND revoked_at IS NULL     -- NOT granted
-- Without SELECT on access_grant every gated request fails with Postgres
-- 42501 (permission denied for table access_grant) and surfaces as HTTP 500.
--
-- Least privilege: SELECT only. The orchestrator never creates or revokes
-- grants; that remains the wren_admin role's responsibility.
--
-- Forward-only and idempotent (GRANT is idempotent in PostgreSQL). The
-- role-existence guard fails loudly if the baseline never ran.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_feedback_orch') THEN
    RAISE EXCEPTION
      'Role wren_feedback_orch does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

GRANT CONNECT ON DATABASE appdb TO wren_feedback_orch;
GRANT USAGE ON SCHEMA public TO wren_feedback_orch;

GRANT SELECT ON TABLE public.access_grant TO wren_feedback_orch;
