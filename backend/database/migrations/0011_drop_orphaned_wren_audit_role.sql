-- ===========================================================================
-- 0011_drop_orphaned_wren_audit_role.sql
--
-- Retire the orphaned wren_audit LOGIN role.
--
-- WHY: wren_audit existed only for the audit Lambda, which was removed (it was
-- never wired to any route). When that service went away the role was dropped
-- from the squashed baseline (0001), so fresh databases never create it. But a
-- database that had already recorded 0001_baseline.sql in schema_migrations does
-- NOT re-run the rewritten file -- so environments provisioned before the
-- fold-out still carry a live wren_audit LOGIN role with its old grants (SELECT
-- on activity_event and the feedback tables, plus CONNECT/USAGE). Its Secrets
-- Manager secret is gone and it sits outside all password rotation/sync
-- automation, so it is a long-lived, unrotatable credential with no owner.
--
-- Like 0002, 0003 and 0006, this is a forward-only, idempotent repair: it
-- removes the role (and its residual grants) from any previously-provisioned
-- database and is a clean no-op on fresh deploys (which never created it).
--
-- Every statement here is idempotent and runs only when the role is present:
--   * REVOKE ALL PRIVILEGES ON DATABASE   -- clears the database-level grants
--   * DROP OWNED BY                        -- revokes every object-level grant
--                                             and drops any objects it owns in
--                                             this database so DROP ROLE succeeds
--   * DROP ROLE                            -- removes the role itself
-- The pg_roles existence guard makes the whole block a no-op when the role has
-- already been dropped (or was never created).
-- ===========================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_audit') THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM wren_audit', current_database());
    DROP OWNED BY wren_audit;
    DROP ROLE wren_audit;
  END IF;
END $$;
