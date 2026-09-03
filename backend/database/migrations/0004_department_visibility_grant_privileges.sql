BEGIN;

-- Grant the least-privilege admin LOGIN role access to the
-- `department_visibility_grant` table.
--
-- Migration 0002 created `public.department_visibility_grant` but never granted
-- any privileges on it. The Admin Service Lambda connects as `wren_admin` and
-- lists/creates/soft-revokes visibility grants
-- (`departmentVisibilityGrantService`) plus reads the table from
-- `departmentService.listDepartments`. Without an explicit grant PostgreSQL
-- rejects those statements with "permission denied for table
-- department_visibility_grant", surfaced to the UI as HTTP 500 on
-- `GET /v1/departments/{departmentId}/visibility-grants`.
--
-- Revocation is a soft-delete (`UPDATE ... SET revoked_at = now()`), so DELETE
-- is not strictly required today, but it is granted to match the privilege set
-- of the other admin-managed tables in the baseline (0001).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.department_visibility_grant
  TO wren_admin;

COMMIT;
