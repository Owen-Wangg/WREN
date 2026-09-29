-- ===========================================================================
-- 0005_document_activity_event_grant.sql
--
-- Document-deletion audit remediation (Issue #187): grant the wren_document
-- role the privileges it needs on public.activity_event so destructive
-- document deletions can be recorded in the activity log.
--
-- WHY: handleDeleteDocument (backend/document/src/lambda-handler.ts) permanently
-- destroys a Student's drafts, feedback items, S3 objects, and DynamoDB
-- conversation state. Requirement 44 / REQ-AUDIT-RETENTION-01 require an
-- independent activity_event to survive that deletion (the activity log holds
-- NO foreign key to document/draft/feedback_item, so it is never cascaded).
--
-- The baseline (0001) grants activity_event only to wren_admin and wren_audit
-- (SELECT), so the Document Lambda (role: wren_document) could not INSERT an
-- audit row at all — making the documented retention contract vacuous. The
-- shared recordActivityEvent writer does:
--
--   INSERT INTO activity_event (...) VALUES (...) RETURNING <columns>
--
-- so the role needs INSERT (the write) and SELECT (the RETURNING read). The id
-- column defaults from gen_random_uuid() (no sequence), so no sequence USAGE is
-- required.
--
-- Like 0002/0003, this is forward-only and idempotent (GRANT is idempotent in
-- PostgreSQL), and it fixes both existing environments (which will not re-run
-- the squashed baseline) and fresh deploys (which apply it in order). The
-- role-existence guard keeps it safe even if the role was somehow not created.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wren_document') THEN
    RAISE EXCEPTION
      'Role wren_document does not exist; run the role-creation baseline (0001) first.';
  END IF;
END $$;

-- Baseline connectivity privileges (idempotent; re-assert in case they too were
-- missed on a pre-squash environment).
GRANT CONNECT ON DATABASE appdb TO wren_document;
GRANT USAGE ON SCHEMA public TO wren_document;

-- The exact table privileges the document-deletion audit path requires:
--   * INSERT — write the activity_event row.
--   * SELECT — the writer uses RETURNING to read back the inserted row.
GRANT SELECT, INSERT ON TABLE public.activity_event TO wren_document;
