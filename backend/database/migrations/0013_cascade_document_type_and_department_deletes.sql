-- ===========================================================================
-- 0013_cascade_document_type_and_department_deletes.sql
--
-- Admin deletion remediation: an admin deleting a Document Type (or a whole
-- Department) must succeed regardless of how many student Documents still use
-- it. Previously:
--
--   * document.document_type_id                      ON DELETE RESTRICT
--   * feedback_helpfulness_rating.document_type_id   (no action -> NO ACTION)
--
-- blocked the delete with a Postgres 23503, which the Admin service surfaced as
-- a 409 "documents still use it". Because department -> document_type already
-- CASCADEs, the same RESTRICT also made a hard Department delete impossible.
--
-- After this migration:
--
--   department --CASCADE--> document_type --CASCADE--> document
--     --CASCADE--> draft / feedback_item / anchor / resolution_status_history /
--                  debrief_section_applicability / document_ingest_job /
--                  feedback_helpfulness_rating
--
-- activity_event and aggregate_counter keep NO foreign key to document (schema
-- invariant 4/6), so the audit log and analytics are still retained.
--
-- feedback_item.error_category_id becomes NO ACTION DEFERRABLE INITIALLY
-- DEFERRED (was RESTRICT). Postgres runs referential actions as per-level
-- AFTER triggers, so a non-deferred check queued by the document_type ->
-- error_category cascade fires before the sibling document_type -> document ->
-- feedback_item cascade has removed the referencing rows (observed in dev as
-- 23503 on feedback_item_error_category_id_fkey). Deferring the check to
-- COMMIT lets every cascade finish first, while deleting an error_category
-- that feedback_item rows still reference is still rejected with 23503.
--
-- activity_event's FKs to department / document_type (ON DELETE SET NULL) are
-- DROPPED. The SET NULL is executed as an UPDATE on activity_event, which the
-- append-only trigger (activity_event_append_only, BEFORE UPDATE OR DELETE)
-- rejects -- so any Department or Document Type that had ever been audited
-- could not be deleted at all. Dropping the FK (rather than weakening the
-- trigger) keeps the log append-only and preserves the original ids on
-- historical events, consistent with invariant 4 (activity_event is
-- independent of the rows it describes).
--
-- No grants change. Referential actions run as the owner of the referencing
-- table, so wren_admin still has NO direct DELETE on student-work tables.
--
-- Forward-only and idempotent: each constraint is dropped IF EXISTS and
-- re-added with the same name. Wrapped so a partially-provisioned database
-- (table absent) is a no-op, matching the 0002-0012 style.
-- ===========================================================================

DO $$ BEGIN
  ALTER TABLE ONLY public.document
    DROP CONSTRAINT IF EXISTS document_writing_type_id_fkey;
  ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_writing_type_id_fkey FOREIGN KEY (document_type_id)
      REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.feedback_helpfulness_rating
    DROP CONSTRAINT IF EXISTS feedback_helpfulness_rating_document_type_id_fkey;
  ALTER TABLE ONLY public.feedback_helpfulness_rating
    ADD CONSTRAINT feedback_helpfulness_rating_document_type_id_fkey FOREIGN KEY (document_type_id)
      REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.feedback_item
    DROP CONSTRAINT IF EXISTS feedback_item_error_category_id_fkey;
  ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT feedback_item_error_category_id_fkey FOREIGN KEY (error_category_id)
      REFERENCES public.error_category(id) ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.activity_event
    DROP CONSTRAINT IF EXISTS activity_event_department_id_fkey;
  ALTER TABLE ONLY public.activity_event
    DROP CONSTRAINT IF EXISTS activity_event_document_type_id_fkey;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
