BEGIN;

-- Grant the authorizer LOGIN role UPDATE on `app_user` so first-login
-- provisioning can run.
--
-- The API Gateway custom authorizer connects as `wren_authorizer` and, on a
-- user's first login, calls `ensureAppUser` (backend/auth/src/provisionUser.ts).
-- That path executes:
--   * `INSERT INTO app_user (...) ON CONFLICT (idp_subject) DO UPDATE SET ...`
--   * `UPDATE app_user SET idp_subject = ... (email relink)`
-- PostgreSQL requires the UPDATE privilege to *plan* an `ON CONFLICT DO UPDATE`
-- statement even when no conflict occurs at runtime, so a brand-new user's
-- INSERT fails with "permission denied for table app_user". The authorizer then
-- throws, API Gateway returns a 500 WITHOUT the service's CORS headers, and the
-- browser surfaces it as a CORS error on GET /v1/auth/me — blocking signup.
--
-- The baseline (0001) granted `wren_authorizer` only SELECT, INSERT on
-- `app_user`. Existing users are unaffected because their identity resolves
-- before `ensureAppUser` runs; only new/relinked users hit the write path.
GRANT UPDATE ON TABLE public.app_user TO wren_authorizer;

COMMIT;
