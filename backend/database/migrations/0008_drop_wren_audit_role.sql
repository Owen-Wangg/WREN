-- ===========================================================================
-- 0008_drop_wren_audit_role.sql
--
-- Retires the wren_audit LOGIN role (security finding f-71876844).
--
-- WHY: wren_audit's only consumer was the `${prefix}-audit` Lambda, which had
-- no API route (/v1/analytics is served by the admin Lambda) and trusted a
-- caller-supplied authorizer context (finding f-4741b84f). That Lambda has
-- been removed, and CDK no longer registers the role with RDS Proxy or syncs
-- its password. Leaving the login in place would keep a credential with
-- SELECT on analytics / feedback tables that no workload owns.
--
-- WHAT: revokes every privilege the baseline (0001) granted to wren_audit,
-- then drops the role. The role was created by the migration admin and owns
-- no objects; the ownership guard below fails loudly instead of letting
-- DROP OWNED silently delete anything if that ever stops being true.
--
-- Forward-only and idempotent: a no-op when the role is already gone.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_audit') THEN
    RAISE NOTICE 'Role wren_audit does not exist; nothing to drop.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
    WHERE r.rolname = 'wren_audit'
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE r.rolname = 'wren_audit'
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
    WHERE r.rolname = 'wren_audit'
  ) THEN
    RAISE EXCEPTION
      'Role wren_audit owns database objects; reassign them before dropping the role.';
  END IF;

  -- Block new sessions first, then strip privileges, then drop.
  ALTER ROLE wren_audit NOLOGIN;

  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM wren_audit;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM wren_audit;
  REVOKE ALL PRIVILEGES ON SCHEMA public FROM wren_audit;
  REVOKE ALL PRIVILEGES ON DATABASE appdb FROM wren_audit;

  -- Ownership was asserted empty above, so this only clears any remaining
  -- privilege/default-ACL entries in this database.
  DROP OWNED BY wren_audit;

  DROP ROLE wren_audit;
END $$;
