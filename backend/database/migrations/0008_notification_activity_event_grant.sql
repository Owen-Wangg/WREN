-- ===========================================================================
-- 0008_notification_activity_event_grant.sql
--
-- Notification_Type catalog audit remediation: give the wren_notification role
-- exactly what it needs to record a durable audit event when a TechnicalAdmin
-- creates or updates a Notification_Type.
--
-- WHY: creating or updating a Notification_Type is authorship over the content
-- of every user's inbox, but the catalog routes
-- (backend/notification/src/lambda-handler.ts) previously wrote no
-- activity_event. They now record every successful create/update as a
-- `notification_type.created` / `notification_type.updated` event through the
-- shared INSERT-only writer (appendActivityEventRow):
--     INSERT INTO activity_event (...) VALUES (...)      -- no RETURNING
-- so the role needs INSERT only. It is deliberately NOT granted SELECT: the
-- Notification_Service has no reason to read the rest of the activity log.
-- activity_event stays append-only: no UPDATE/DELETE is granted, and the
-- reject_activity_event_mutation trigger (0006) applies.
--
-- Forward-only and idempotent (GRANT is idempotent in PostgreSQL). The
-- role-existence guard fails loudly if the baseline never ran.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_notification') THEN
    RAISE EXCEPTION
      'Role wren_notification does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

GRANT CONNECT ON DATABASE appdb TO wren_notification;
GRANT USAGE ON SCHEMA public TO wren_notification;

-- Durable Notification_Type catalog audit record: write-only, append-only.
GRANT INSERT ON TABLE public.activity_event TO wren_notification;
