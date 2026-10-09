-- ===========================================================================
-- 0010_document_ask_message_count.sql
--
-- Ask WREN lifetime message-cap durability remediation (finding f-4cd612e7):
-- move the per-document Ask WREN message counter off the TTL'd DynamoDB session
-- item into a durable Postgres column so the "lifetime" cap cannot reset.
--
-- WHY: The per-document Ask WREN message quota (platform_usage_policy.message_limit,
-- default 100) was enforced only via a `messageCount` attribute on the DynamoDB
-- ConversationHistory session item, which carries a 30-day TTL. Once that item
-- expired the reservation's `attribute_not_exists(messageCount)` branch succeeded
-- and the count restarted at 0 — so a user who paused a document for 30 days got a
-- fresh 100-message allowance repeatedly and billed Bedrock usage was unbounded
-- per document.
--
-- This column mirrors the existing durable lifetime counters on `document`
-- (`debrief_generation_count`, `draft_create_count`): it is incremented atomically
-- by reserveAskMessage() in backend/admin/src/lifetimeUsagePolicy.ts via
--   UPDATE document SET ask_message_count = ask_message_count + 1
--     WHERE id = $1 AND ask_message_count < $2 RETURNING ask_message_count
-- run by the Feedback Orchestrator Lambda (role: wren_feedback_orch).
--
-- No new grants are required: the baseline (0001) already grants wren_feedback_orch
-- table-level SELECT and UPDATE on public.document (covering the new column and the
-- RETURNING read). Do NOT widen privileges here.
--
-- Forward-only and idempotent: ADD COLUMN IF NOT EXISTS plus a duplicate_object
-- guard on the CHECK constraint, matching the style of 0002–0009. Existing rows
-- default to 0 (one-time reset of any in-flight DynamoDB count is accepted — there
-- is no reliable backfill source).
-- ===========================================================================

ALTER TABLE public.document
  ADD COLUMN IF NOT EXISTS ask_message_count integer DEFAULT 0 NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.document
    ADD CONSTRAINT document_ask_message_count_check CHECK ((ask_message_count >= 0));
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;
