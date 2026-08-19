-- Migration 0027 — per-Lambda Postgres roles (least privilege).
--
-- CREATE ROLE with LOGIN but NO password here — CDK generates Secrets Manager
-- secrets and a custom resource runs ALTER ROLE … PASSWORD. Do not put
-- passwords in git.
--
-- Missing GRANT after cutover shows up as Postgres "permission denied" —
-- add a follow-up 0028_* migration rather than reverting Lambdas to dbadmin.

BEGIN;

-- ---------------------------------------------------------------------------
-- Roles (idempotent: re-applying this file outside schema_migrations is safe)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE ROLE wren_authorizer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_appsync_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_document LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_audit LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_feedback_orch LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_feedback_engine LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE wren_notification LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT CONNECT ON DATABASE appdb TO
  wren_authorizer,
  wren_appsync_auth,
  wren_document,
  wren_admin,
  wren_audit,
  wren_feedback_orch,
  wren_feedback_engine,
  wren_notification;

GRANT USAGE ON SCHEMA public TO
  wren_authorizer,
  wren_appsync_auth,
  wren_document,
  wren_admin,
  wren_audit,
  wren_feedback_orch,
  wren_feedback_engine,
  wren_notification;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO
  wren_authorizer,
  wren_appsync_auth,
  wren_document,
  wren_admin,
  wren_audit,
  wren_feedback_orch,
  wren_feedback_engine,
  wren_notification;

-- ---------------------------------------------------------------------------
-- wren_authorizer — REST authorizer provisions app_user + Student role
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON TABLE app_user, role_assignment TO wren_authorizer;
GRANT SELECT ON TABLE access_grant TO wren_authorizer;

-- ---------------------------------------------------------------------------
-- wren_appsync_auth — JWT → identity + document ownership (no INSERT)
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE app_user, role_assignment, access_grant, document TO wren_appsync_auth;

-- ---------------------------------------------------------------------------
-- wren_document — document/draft/ingest graph + catalog lookups
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  document,
  draft,
  feedback_item,
  anchor,
  resolution_status_history,
  document_ingest_job,
  aggregate_counter
  TO wren_document;

GRANT SELECT ON TABLE document_type, department, content_type TO wren_document;

-- ---------------------------------------------------------------------------
-- wren_admin — catalog / authz / usage / activity DML (not DDL)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  department,
  document_type,
  document_type_config,
  error_category,
  content_type,
  custom_metadata_field,
  topic,
  reference_material,
  app_user,
  role_assignment,
  access_grant,
  usage_limit,
  usage_counter,
  override,
  platform_usage_policy,
  activity_event,
  aggregate_counter
  TO wren_admin;

GRANT SELECT ON TABLE
  document,
  draft,
  feedback_item,
  anchor,
  resolution_status_history,
  feedback_helpfulness_rating,
  debrief_section_applicability
  TO wren_admin;

-- ---------------------------------------------------------------------------
-- wren_audit — analytics reads (SELECT only)
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE
  aggregate_counter,
  document_type,
  department,
  resolution_status_history,
  feedback_item,
  error_category,
  feedback_helpfulness_rating,
  debrief_section_applicability
  TO wren_audit;

-- ---------------------------------------------------------------------------
-- wren_feedback_orch — debrief graph + ratings; document status
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE
  document,
  draft,
  feedback_item,
  anchor,
  error_category,
  document_type,
  document_type_config,
  department,
  resolution_status_history,
  platform_usage_policy
  TO wren_feedback_orch;

GRANT SELECT, INSERT, UPDATE ON TABLE
  feedback_helpfulness_rating,
  debrief_section_applicability
  TO wren_feedback_orch;

GRANT UPDATE ON TABLE document TO wren_feedback_orch;

-- ---------------------------------------------------------------------------
-- wren_feedback_engine — config/taxonomy/draft reads; feedback writes
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE
  document,
  draft,
  document_type,
  document_type_config,
  department,
  error_category,
  platform_usage_policy,
  feedback_item,
  anchor
  TO wren_feedback_engine;

GRANT SELECT, INSERT, UPDATE ON TABLE
  feedback_item,
  anchor,
  resolution_status_history,
  aggregate_counter
  TO wren_feedback_engine;

-- ---------------------------------------------------------------------------
-- wren_notification — inbox R/W; recipient lookup
-- (override / document_type granted for stale usage_override / writing_type SQL)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE notification, notification_type
  TO wren_notification;

GRANT SELECT ON TABLE role_assignment, override, document_type, app_user, department
  TO wren_notification;

COMMIT;
