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
--   * GRANT wren_audit TO current_user    -- the migration runner connects as the
--                                             RDS master user, which is NOT a true
--                                             superuser (rds_superuser membership
--                                             only). REASSIGN OWNED / DROP OWNED /
--                                             DROP ROLE require the executing role
--                                             to be a MEMBER of the target role, so
--                                             grant that membership transiently.
--                                             The grant is dropped together with the
--                                             role in this same transaction, so no
--                                             privilege survives the block.
--   * REASSIGN OWNED BY … TO current_user -- safety belt: wren_audit owns no objects
--                                             (it only ever held grants), so this is
--                                             a no-op; but if any environment somehow
--                                             has owned objects, reassign them rather
--                                             than let DROP OWNED destroy them.
--   * DROP OWNED BY                        -- revokes every object-level grant and
--                                             drops anything it owns in this database
--                                             so DROP ROLE succeeds
--   * DROP ROLE                            -- removes the role itself
-- The pg_roles existence guard makes the whole block a no-op when the role has
-- already been dropped (or was never created).
-- ===========================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_audit') THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM wren_audit', current_database());
    GRANT wren_audit TO current_user;
    REASSIGN OWNED BY wren_audit TO current_user;
    DROP OWNED BY wren_audit;
    DROP ROLE wren_audit;
  END IF;
END $$;
