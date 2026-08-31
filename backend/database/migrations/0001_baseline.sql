-- 0001_baseline.sql
-- Consolidated idempotent schema baseline (migr 0001-0036).
-- Generated from pg_dump of deployed wren-dev database (2026-08-31).
-- Safe to run against an already-migrated database.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', true);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: reject_draft_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.reject_draft_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.s3_key IS DISTINCT FROM OLD.s3_key
       OR NEW.segments IS DISTINCT FROM OLD.segments
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION
            'Draft rows are immutable (id=%); only content/word_count may be updated for autosave.',
            OLD.id;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: reject_resolution_history_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.reject_resolution_history_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'resolution_status_history is append-only (id=%).', OLD.id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.access_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    document_type_id uuid NOT NULL
);


--
-- Name: activity_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.activity_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_pseudonym text NOT NULL,
    verb text NOT NULL,
    object_type text NOT NULL,
    object_ref text NOT NULL,
    document_type_id uuid,
    department_id uuid,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: aggregate_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.aggregate_counter (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_kind text NOT NULL,
    scope_id uuid,
    metric text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    value bigint DEFAULT 0 NOT NULL
);


--
-- Name: anchor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.anchor (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feedback_item_id uuid NOT NULL,
    draft_id uuid NOT NULL,
    paragraph_index integer NOT NULL,
    start_offset integer NOT NULL,
    end_offset integer NOT NULL,
    content_fingerprint text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT anchor_end_offset_check CHECK ((end_offset >= 0)),
    CONSTRAINT anchor_offset_order CHECK ((end_offset >= start_offset)),
    CONSTRAINT anchor_paragraph_index_check CHECK ((paragraph_index >= 0)),
    CONSTRAINT anchor_start_offset_check CHECK ((start_offset >= 0)),
    CONSTRAINT anchor_state_check CHECK ((state = ANY (ARRAY['active'::text, 'removed'::text])))
);


--
-- Name: app_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    idp_subject text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: content_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.content_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type_id uuid NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_metadata_field; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.custom_metadata_field (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type_id uuid NOT NULL,
    label text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: debrief_section_applicability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.debrief_section_applicability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    draft_id uuid NOT NULL,
    error_category_id uuid NOT NULL,
    applicable boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: department; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.department (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    prompt text,
    access_state text DEFAULT 'OPEN'::text NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT department_access_state_check CHECK ((access_state = ANY (ARRAY['OPEN'::text, 'LOCKED'::text])))
);


--
-- Name: document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    content_type_id uuid,
    name text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'Still Drafting'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    debrief_generation_count integer DEFAULT 0 NOT NULL,
    draft_create_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT document_debrief_generation_count_check CHECK ((debrief_generation_count >= 0)),
    CONSTRAINT document_draft_create_count_check CHECK ((draft_create_count >= 0))
);


--
-- Name: document_ingest_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.document_ingest_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    s3_key text NOT NULL,
    file_name text NOT NULL,
    status text NOT NULL,
    error_message text,
    draft_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ocr_engine text DEFAULT 'textract'::text NOT NULL,
    comparison jsonb,
    CONSTRAINT document_ingest_job_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: document_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.document_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    access_state text DEFAULT 'OPEN'::text NOT NULL,
    size_limit_words integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_type_access_state_check CHECK ((access_state = ANY (ARRAY['OPEN'::text, 'LOCKED'::text]))),
    CONSTRAINT writing_type_size_limit_words_check CHECK (((size_limit_words IS NULL) OR (size_limit_words > 0)))
);


--
-- Name: document_type_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.document_type_config (
    document_type_id uuid NOT NULL,
    tone text,
    density text,
    category_priority jsonb DEFAULT '[]'::jsonb NOT NULL,
    type_prompt_text text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tone_description text,
    density_description text,
    structure_description text,
    restrictions_description text,
    notes_description text,
    citation_config jsonb
);


--
-- Name: draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.draft (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    version_number integer NOT NULL,
    s3_key text NOT NULL,
    segments jsonb NOT NULL,
    word_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content jsonb,
    content_updated_at timestamp with time zone,
    header jsonb,
    footer jsonb,
    ocr_confidence numeric(5,2),
    CONSTRAINT draft_version_number_check CHECK ((version_number > 0)),
    CONSTRAINT draft_word_count_check CHECK ((word_count >= 0))
);


--
-- Name: error_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.error_category (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type_id uuid NOT NULL,
    name text NOT NULL,
    internal_guidance text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_helpfulness_rating; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.feedback_helpfulness_rating (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    draft_id uuid,
    document_type_id uuid NOT NULL,
    helpful boolean NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.feedback_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    error_category_id uuid NOT NULL,
    kind text NOT NULL,
    question_text text NOT NULL,
    current_anchor_id uuid,
    citation_reference_id uuid,
    source_draft_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quoted_text text,
    positive_note text,
    CONSTRAINT feedback_item_kind_check CHECK ((kind = ANY (ARRAY['inline'::text, 'structural'::text, 'strength'::text])))
);


--
-- Name: notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_type_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    state character varying(20) DEFAULT 'unread'::character varying NOT NULL,
    rendered_content text NOT NULL,
    action_url text,
    dedup_key character varying(512),
    context jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    CONSTRAINT notification_state_check CHECK (((state)::text = ANY ((ARRAY['unread'::character varying, 'read'::character varying, 'dismissed'::character varying])::text[])))
);


--
-- Name: notification_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notification_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    label character varying(255) NOT NULL,
    display_template text NOT NULL,
    action_url_template text,
    target_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    dedup_strategy jsonb DEFAULT '{"enabled": false}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.override (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    bounds jsonb NOT NULL,
    reason text NOT NULL,
    granted_by uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_usage_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.platform_usage_policy (
    id integer DEFAULT 1 NOT NULL,
    message_limit integer DEFAULT 100 NOT NULL,
    debrief_generation_limit integer DEFAULT 15 NOT NULL,
    document_upload_limit integer DEFAULT 30 NOT NULL,
    drafts_per_document_limit integer DEFAULT 15 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bedrock_model_id text,
    CONSTRAINT platform_usage_policy_debrief_generation_limit_check CHECK ((debrief_generation_limit >= 1)),
    CONSTRAINT platform_usage_policy_document_upload_limit_check CHECK ((document_upload_limit >= 1)),
    CONSTRAINT platform_usage_policy_drafts_per_document_limit_check CHECK ((drafts_per_document_limit >= 1)),
    CONSTRAINT platform_usage_policy_id_check CHECK ((id = 1)),
    CONSTRAINT platform_usage_policy_message_limit_check CHECK ((message_limit >= 1))
);


--
-- Name: reference_material; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.reference_material (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier text NOT NULL,
    department_id uuid,
    document_type_id uuid,
    title text NOT NULL,
    section text,
    content_kind text NOT NULL,
    s3_key text,
    inline_content text,
    embedding_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reference_material_content_kind_check CHECK ((content_kind = ANY (ARRAY['file'::text, 'text'::text, 'html'::text]))),
    CONSTRAINT reference_material_tier_check CHECK ((tier = ANY (ARRAY['org'::text, 'domain'::text]))),
    CONSTRAINT reference_material_tier_scope CHECK ((((tier = 'department'::text) AND (department_id IS NOT NULL)) OR ((tier = 'type'::text) AND (document_type_id IS NOT NULL))))
);


--
-- Name: resolution_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.resolution_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feedback_item_id uuid NOT NULL,
    draft_id uuid NOT NULL,
    status text NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resolution_status_history_status_check CHECK ((status = ANY (ARRAY['resolved'::text, 'partially_resolved'::text, 'still_unresolved'::text, 'removed'::text, 'unchanged'::text])))
);


--
-- Name: role_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.role_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    scope jsonb,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_assignment_role_check CHECK ((role = ANY (ARRAY['Student'::text, 'DepartmentAdmin'::text, 'TechnicalAdmin'::text])))
);



--
-- Name: topic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.topic (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: usage_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.usage_counter (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_kind text NOT NULL,
    scope_id uuid,
    period_start timestamp with time zone NOT NULL,
    consumed integer DEFAULT 0 NOT NULL,
    CONSTRAINT usage_counter_consumed_check CHECK ((consumed >= 0)),
    CONSTRAINT usage_counter_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['platform'::text, 'documentType'::text])))
);


--
-- Name: usage_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.usage_limit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_kind text NOT NULL,
    scope_id uuid,
    limit_value integer NOT NULL,
    period text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_limit_limit_value_check CHECK ((limit_value >= 0)),
    CONSTRAINT usage_limit_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['platform'::text, 'documentType'::text])))
);


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_identities (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    cognito_subject character varying(500) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_lifetime_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_lifetime_usage (
    user_id uuid NOT NULL,
    document_upload_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT user_lifetime_usage_document_upload_count_check CHECK ((document_upload_count >= 0))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_role_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role character varying(50) NOT NULL,
    scope_kind character varying(50),
    scope_id uuid,
    assigned_at timestamp without time zone DEFAULT now(),
    assigned_by uuid
);


--
-- Name: access_grant access_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.access_grant
    ADD CONSTRAINT access_grant_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: activity_event activity_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.activity_event
    ADD CONSTRAINT activity_event_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: aggregate_counter aggregate_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.aggregate_counter
    ADD CONSTRAINT aggregate_counter_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: aggregate_counter aggregate_counter_scope_kind_scope_id_metric_window_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.aggregate_counter
    ADD CONSTRAINT aggregate_counter_scope_kind_scope_id_metric_window_start_key UNIQUE (scope_kind, scope_id, metric, window_start);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: anchor anchor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.anchor
    ADD CONSTRAINT anchor_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: app_user app_user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: app_user app_user_idp_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_idp_subject_key UNIQUE (idp_subject);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: content_type content_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.content_type
    ADD CONSTRAINT content_type_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: custom_metadata_field custom_metadata_field_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.custom_metadata_field
    ADD CONSTRAINT custom_metadata_field_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: debrief_section_applicability debrief_section_applicability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.debrief_section_applicability
    ADD CONSTRAINT debrief_section_applicability_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_ingest_job document_ingest_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_ingest_job
    ADD CONSTRAINT document_ingest_job_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: draft draft_document_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.draft
    ADD CONSTRAINT draft_document_id_version_number_key UNIQUE (document_id, version_number);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: draft draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.draft
    ADD CONSTRAINT draft_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: error_category error_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.error_category
    ADD CONSTRAINT error_category_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: error_category error_category_writing_type_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.error_category
    ADD CONSTRAINT error_category_writing_type_id_name_key UNIQUE (document_type_id, name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_helpfulness_rating feedback_helpfulness_rating_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_helpfulness_rating
    ADD CONSTRAINT feedback_helpfulness_rating_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_item feedback_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT feedback_item_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: notification_type notification_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.notification_type
    ADD CONSTRAINT notification_type_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: notification_type notification_type_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.notification_type
    ADD CONSTRAINT notification_type_slug_key UNIQUE (slug);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: department organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.department
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: override override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.override
    ADD CONSTRAINT override_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: platform_usage_policy platform_usage_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.platform_usage_policy
    ADD CONSTRAINT platform_usage_policy_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: reference_material reference_material_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.reference_material
    ADD CONSTRAINT reference_material_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: resolution_status_history resolution_status_history_feedback_item_id_draft_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.resolution_status_history
    ADD CONSTRAINT resolution_status_history_feedback_item_id_draft_id_key UNIQUE (feedback_item_id, draft_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: resolution_status_history resolution_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.resolution_status_history
    ADD CONSTRAINT resolution_status_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: role_assignment role_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.role_assignment
    ADD CONSTRAINT role_assignment_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;



--
-- Name: topic topic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.topic
    ADD CONSTRAINT topic_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_helpfulness_rating uq_feedback_helpfulness_document_draft; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_helpfulness_rating
    ADD CONSTRAINT uq_feedback_helpfulness_document_draft UNIQUE (document_id, draft_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: debrief_section_applicability uq_section_applicability; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.debrief_section_applicability
    ADD CONSTRAINT uq_section_applicability UNIQUE (document_id, draft_id, error_category_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: usage_counter usage_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.usage_counter
    ADD CONSTRAINT usage_counter_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: usage_counter usage_counter_scope_kind_scope_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.usage_counter
    ADD CONSTRAINT usage_counter_scope_kind_scope_id_period_start_key UNIQUE (scope_kind, scope_id, period_start);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: usage_limit usage_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.usage_limit
    ADD CONSTRAINT usage_limit_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_identities user_identities_cognito_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_cognito_subject_key UNIQUE (cognito_subject);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_identities user_identities_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_lifetime_usage user_lifetime_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_lifetime_usage
    ADD CONSTRAINT user_lifetime_usage_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_role_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_roles user_roles_user_id_role_scope_kind_scope_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_scope_kind_scope_id_key UNIQUE (user_id, role, scope_kind, scope_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_type_config writing_type_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_type_config
    ADD CONSTRAINT writing_type_config_pkey PRIMARY KEY (document_type_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_type writing_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_type
    ADD CONSTRAINT writing_type_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: idx_access_grant_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_access_grant_document_type ON public.access_grant USING btree (document_type_id);


--
-- Name: idx_access_grant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_access_grant_user ON public.access_grant USING btree (user_id);


--
-- Name: idx_activity_event_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_activity_event_timestamp ON public.activity_event USING btree ("timestamp");


--
-- Name: idx_anchor_draft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_anchor_draft ON public.anchor USING btree (draft_id);


--
-- Name: idx_anchor_feedback_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_anchor_feedback_item ON public.anchor USING btree (feedback_item_id);


--
-- Name: idx_content_type_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_content_type_document_type ON public.content_type USING btree (document_type_id);


--
-- Name: idx_custom_metadata_field_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_custom_metadata_field_document_type ON public.custom_metadata_field USING btree (document_type_id);


--
-- Name: idx_document_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_document_document_type ON public.document USING btree (document_type_id);


--
-- Name: idx_document_ingest_job_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_document_ingest_job_document ON public.document_ingest_job USING btree (document_id, created_at DESC);


--
-- Name: idx_document_ingest_job_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_document_ingest_job_status ON public.document_ingest_job USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));


--
-- Name: idx_document_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_document_owner ON public.document USING btree (owner_user_id);


--
-- Name: idx_document_type_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_document_type_dept ON public.document_type USING btree (department_id);


--
-- Name: idx_draft_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_draft_document ON public.draft USING btree (document_id);


--
-- Name: idx_error_category_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_error_category_document_type ON public.error_category USING btree (document_type_id);


--
-- Name: idx_feedback_item_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feedback_item_category ON public.feedback_item USING btree (error_category_id);


--
-- Name: idx_feedback_item_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feedback_item_document ON public.feedback_item USING btree (document_id);


--
-- Name: idx_helpfulness_rating_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_helpfulness_rating_document_type ON public.feedback_helpfulness_rating USING btree (document_type_id, created_at DESC);


--
-- Name: idx_notification_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedup ON public.notification USING btree (dedup_key) WHERE ((dedup_key IS NOT NULL) AND ((state)::text <> 'dismissed'::text));


--
-- Name: idx_notification_inbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notification_inbox ON public.notification USING btree (recipient_user_id, created_at DESC) WHERE ((state)::text <> 'dismissed'::text);


--
-- Name: idx_notification_type_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notification_type_slug ON public.notification_type USING btree (slug);


--
-- Name: idx_notification_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notification_unread ON public.notification USING btree (recipient_user_id) WHERE ((state)::text = 'unread'::text);


--
-- Name: idx_override_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_override_user ON public.override USING btree (user_id);


--
-- Name: idx_reference_material_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_reference_material_dept ON public.reference_material USING btree (department_id);


--
-- Name: idx_reference_material_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_reference_material_document_type ON public.reference_material USING btree (document_type_id);


--
-- Name: idx_resolution_history_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resolution_history_item ON public.resolution_status_history USING btree (feedback_item_id);


--
-- Name: idx_role_assignment_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_role_assignment_user ON public.role_assignment USING btree (user_id);


--
-- Name: idx_section_applicability_debrief; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_section_applicability_debrief ON public.debrief_section_applicability USING btree (document_id, draft_id);


--
-- Name: idx_topic_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_topic_dept ON public.topic USING btree (department_id);


--
-- Name: idx_user_identities_cognito_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_identities_cognito_subject ON public.user_identities USING btree (cognito_subject);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles USING btree (role);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: draft draft_immutable; Type: TRIGGER; Schema: public; Owner: -
--

DROP TRIGGER IF EXISTS draft_immutable ON public.draft;
CREATE TRIGGER draft_immutable BEFORE UPDATE ON public.draft FOR EACH ROW EXECUTE FUNCTION public.reject_draft_update();


--
-- Name: resolution_status_history resolution_status_history_append_only; Type: TRIGGER; Schema: public; Owner: -
--

DROP TRIGGER IF EXISTS resolution_status_history_append_only ON public.resolution_status_history;
CREATE TRIGGER resolution_status_history_append_only BEFORE UPDATE ON public.resolution_status_history FOR EACH ROW EXECUTE FUNCTION public.reject_resolution_history_update();


--
-- Name: access_grant access_grant_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.access_grant
    ADD CONSTRAINT access_grant_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.app_user(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: access_grant access_grant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.access_grant
    ADD CONSTRAINT access_grant_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: activity_event activity_event_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.activity_event
    ADD CONSTRAINT activity_event_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.department(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: activity_event activity_event_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.activity_event
    ADD CONSTRAINT activity_event_document_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: anchor anchor_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.anchor
    ADD CONSTRAINT anchor_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.draft(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: anchor anchor_feedback_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.anchor
    ADD CONSTRAINT anchor_feedback_item_id_fkey FOREIGN KEY (feedback_item_id) REFERENCES public.feedback_item(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: content_type content_type_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.content_type
    ADD CONSTRAINT content_type_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: custom_metadata_field custom_metadata_field_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.custom_metadata_field
    ADD CONSTRAINT custom_metadata_field_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: debrief_section_applicability debrief_section_applicability_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.debrief_section_applicability
    ADD CONSTRAINT debrief_section_applicability_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: debrief_section_applicability debrief_section_applicability_error_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.debrief_section_applicability
    ADD CONSTRAINT debrief_section_applicability_error_category_id_fkey FOREIGN KEY (error_category_id) REFERENCES public.error_category(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document document_content_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_content_type_id_fkey FOREIGN KEY (content_type_id) REFERENCES public.content_type(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_ingest_job document_ingest_job_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_ingest_job
    ADD CONSTRAINT document_ingest_job_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_ingest_job document_ingest_job_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_ingest_job
    ADD CONSTRAINT document_ingest_job_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.draft(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document document_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document document_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: draft draft_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.draft
    ADD CONSTRAINT draft_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: error_category error_category_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.error_category
    ADD CONSTRAINT error_category_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_helpfulness_rating feedback_helpfulness_rating_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_helpfulness_rating
    ADD CONSTRAINT feedback_helpfulness_rating_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_helpfulness_rating feedback_helpfulness_rating_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_helpfulness_rating
    ADD CONSTRAINT feedback_helpfulness_rating_document_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_item feedback_item_citation_reference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT feedback_item_citation_reference_id_fkey FOREIGN KEY (citation_reference_id) REFERENCES public.reference_material(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_item feedback_item_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT feedback_item_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_item feedback_item_error_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT feedback_item_error_category_id_fkey FOREIGN KEY (error_category_id) REFERENCES public.error_category(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_item feedback_item_source_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT feedback_item_source_draft_id_fkey FOREIGN KEY (source_draft_id) REFERENCES public.draft(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: access_grant fk_access_grant_document_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.access_grant
    ADD CONSTRAINT fk_access_grant_document_type FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: feedback_item fk_feedback_item_current_anchor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.feedback_item
    ADD CONSTRAINT fk_feedback_item_current_anchor FOREIGN KEY (current_anchor_id) REFERENCES public.anchor(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: notification notification_notification_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_notification_type_id_fkey FOREIGN KEY (notification_type_id) REFERENCES public.notification_type(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: notification notification_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: override override_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.override
    ADD CONSTRAINT override_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.app_user(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: override override_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.override
    ADD CONSTRAINT override_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: override override_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.override
    ADD CONSTRAINT override_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: reference_material reference_material_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.reference_material
    ADD CONSTRAINT reference_material_organization_id_fkey FOREIGN KEY (department_id) REFERENCES public.department(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: reference_material reference_material_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.reference_material
    ADD CONSTRAINT reference_material_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: resolution_status_history resolution_status_history_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.resolution_status_history
    ADD CONSTRAINT resolution_status_history_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.draft(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: resolution_status_history resolution_status_history_feedback_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.resolution_status_history
    ADD CONSTRAINT resolution_status_history_feedback_item_id_fkey FOREIGN KEY (feedback_item_id) REFERENCES public.feedback_item(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: role_assignment role_assignment_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.role_assignment
    ADD CONSTRAINT role_assignment_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.app_user(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: role_assignment role_assignment_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.role_assignment
    ADD CONSTRAINT role_assignment_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: topic topic_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.topic
    ADD CONSTRAINT topic_organization_id_fkey FOREIGN KEY (department_id) REFERENCES public.department(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_lifetime_usage user_lifetime_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_lifetime_usage
    ADD CONSTRAINT user_lifetime_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.user_identities(user_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_identities(user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_type_config writing_type_config_writing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_type_config
    ADD CONSTRAINT writing_type_config_writing_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_type(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;


--
-- Name: document_type writing_type_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
ALTER TABLE ONLY public.document_type
    ADD CONSTRAINT writing_type_organization_id_fkey FOREIGN KEY (department_id) REFERENCES public.department(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

-- ===========================================================================
-- ROLES (from 0027_app_db_roles.sql)
-- ===========================================================================

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
  wren_authorizer, wren_appsync_auth, wren_document, wren_admin,
  wren_audit, wren_feedback_orch, wren_feedback_engine, wren_notification;

GRANT USAGE ON SCHEMA public TO
  wren_authorizer, wren_appsync_auth, wren_document, wren_admin,
  wren_audit, wren_feedback_orch, wren_feedback_engine, wren_notification;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO
  wren_authorizer, wren_appsync_auth, wren_document, wren_admin,
  wren_audit, wren_feedback_orch, wren_feedback_engine, wren_notification;

-- wren_authorizer
GRANT SELECT, INSERT ON TABLE public.app_user, public.role_assignment TO wren_authorizer;
GRANT SELECT ON TABLE public.access_grant TO wren_authorizer;

-- wren_appsync_auth
GRANT SELECT ON TABLE public.app_user, public.role_assignment, public.access_grant, public.document TO wren_appsync_auth;

-- wren_document
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.document, public.draft, public.feedback_item, public.anchor,
  public.resolution_status_history, public.document_ingest_job, public.aggregate_counter
  TO wren_document;
GRANT SELECT ON TABLE public.document_type, public.department, public.content_type TO wren_document;
GRANT SELECT ON TABLE public.platform_usage_policy TO wren_document;
GRANT SELECT ON TABLE public.access_grant TO wren_document;
GRANT SELECT ON TABLE public.custom_metadata_field TO wren_document;

-- wren_admin
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.department, public.document_type, public.document_type_config,
  public.error_category, public.content_type, public.custom_metadata_field,
  public.topic, public.reference_material, public.app_user, public.role_assignment,
  public.access_grant, public.usage_limit, public.usage_counter,
  public.override, public.platform_usage_policy, public.activity_event,
  public.aggregate_counter
  TO wren_admin;
GRANT SELECT ON TABLE
  public.document, public.draft, public.feedback_item, public.anchor,
  public.resolution_status_history, public.feedback_helpfulness_rating,
  public.debrief_section_applicability
  TO wren_admin;

-- wren_audit
GRANT SELECT ON TABLE
  public.aggregate_counter, public.document_type, public.department,
  public.resolution_status_history, public.feedback_item, public.error_category,
  public.feedback_helpfulness_rating, public.debrief_section_applicability
  TO wren_audit;

-- wren_feedback_orch
GRANT SELECT ON TABLE
  public.document, public.draft, public.feedback_item, public.anchor,
  public.error_category, public.document_type, public.document_type_config,
  public.department, public.resolution_status_history, public.platform_usage_policy
  TO wren_feedback_orch;
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.feedback_helpfulness_rating, public.debrief_section_applicability
  TO wren_feedback_orch;
GRANT UPDATE ON TABLE public.document TO wren_feedback_orch;

-- wren_feedback_engine
GRANT SELECT ON TABLE
  public.document, public.draft, public.document_type, public.document_type_config,
  public.department, public.error_category, public.platform_usage_policy,
  public.feedback_item, public.anchor
  TO wren_feedback_engine;
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.feedback_item, public.anchor, public.resolution_status_history,
  public.aggregate_counter
  TO wren_feedback_engine;
GRANT DELETE ON TABLE
  public.feedback_item, public.anchor, public.resolution_status_history
  TO wren_feedback_engine;

-- wren_notification
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification, public.notification_type
  TO wren_notification;
GRANT SELECT ON TABLE
  public.role_assignment, public.override, public.document_type,
  public.app_user, public.department
  TO wren_notification;

-- ===========================================================================
-- SEED DATA
-- ===========================================================================

-- platform_usage_policy — single required row
INSERT INTO public.platform_usage_policy (id, message_limit, debrief_generation_limit, document_upload_limit, drafts_per_document_limit)
VALUES (1, 100, 15, 30, 15)
ON CONFLICT (id) DO NOTHING;

-- notification_type catalog (from 0024_notification_type_seed.sql)
INSERT INTO public.notification_type (slug, label, display_template, action_url_template, target_roles, dedup_strategy)
VALUES
  ('ai-debrief-ready', 'AI Debrief ready', 'Your feedback for "{{documentName}}" is ready to review.', '/documents/{{documentId}}/debrief', '["Student"]', '{"enabled": false}'),
  ('ai-debrief-failed', 'AI Debrief failed', 'Feedback generation for "{{documentName}}" encountered an issue. You can retry.', '/documents/{{documentId}}', '["Student"]', '{"enabled": true, "windowMinutes": 5, "keyFields": ["documentId", "draftId"]}'),
  ('access-grant-approved', 'Access grant approved', 'Your access request for {{documentTypeName}} has been approved.', '/documents', '["Student"]', '{"enabled": false}'),
  ('access-grant-denied', 'Access grant denied', 'Your access request for {{documentTypeName}} was not approved.', NULL, '["Student"]', '{"enabled": false}'),
  ('usage-limit-warning', 'Usage limit warning', 'You''re approaching the usage limit for {{scopeName}}.', NULL, '["Student"]', '{"enabled": true, "windowMinutes": 1440, "keyFields": ["scopeName"]}'),
  ('usage-limit-reached', 'Usage limit reached', 'You''ve reached the usage limit for {{scopeName}}.', NULL, '["Student"]', '{"enabled": true, "windowMinutes": 1440, "keyFields": ["scopeName"]}'),
  ('temporary-override-granted', 'Temporary override granted', 'You''ve been granted additional usage for {{documentTypeName}}.', '/documents', '["Student"]', '{"enabled": false}'),
  ('access-request-pending', 'Access request pending', '{{studentName}} has requested access to {{documentTypeName}}.', '/admin/access-requests', '["DepartmentAdmin"]', '{"enabled": false}'),
  ('usage-limit-reached-doctype', 'Usage limit reached (Doc Type)', '{{documentTypeName}} has reached its usage limit.', '/admin/usage', '["DepartmentAdmin"]', '{"enabled": true, "windowMinutes": 1440, "keyFields": ["documentTypeId"]}'),
  ('guardrail-violation-flagged', 'Guardrail violation flagged', 'A guardrail violation was flagged for {{documentTypeName}}.', '/admin/guardrails', '["DepartmentAdmin"]', '{"enabled": true, "windowMinutes": 60, "keyFields": ["documentTypeId"]}'),
  ('new-department-appointment', 'New Department appointment', 'You''ve been appointed to administer {{departmentName}}.', '/admin/dashboard', '["DepartmentAdmin"]', '{"enabled": false}'),
  ('reference-material-failed', 'Reference material processing failed', 'Reference material "{{materialTitle}}" for {{documentTypeName}} failed to process.', '/admin/reference-materials', '["DepartmentAdmin"]', '{"enabled": false}'),
  ('override-expiring', 'Override expiring', 'An override you granted for {{studentName}} in {{documentTypeName}} expires soon.', '/admin/overrides', '["DepartmentAdmin"]', '{"enabled": true, "windowMinutes": 720, "keyFields": ["overrideId"]}'),
  ('override-expired', 'Override expired', 'An override you granted for {{studentName}} in {{documentTypeName}} has expired.', '/admin/overrides', '["DepartmentAdmin"]', '{"enabled": true, "windowMinutes": 1440, "keyFields": ["overrideId"]}'),
  ('usage-limit-reached-platform', 'Usage limit reached (platform)', 'The platform-wide usage limit has been reached.', '/admin/platform/usage', '["TechnicalAdmin"]', '{"enabled": true, "windowMinutes": 1440, "keyFields": []}'),
  ('feedback-job-failures', 'Feedback job failures', 'DLQ depth has exceeded the configured threshold ({{count}} messages).', '/admin/platform/jobs', '["TechnicalAdmin"]', '{"enabled": true, "windowMinutes": 60, "keyFields": []}'),
  ('guardrail-violation-spike', 'Guardrail violation spike', 'Guardrail rejection rate has exceeded the anomaly threshold.', '/admin/platform/guardrails', '["TechnicalAdmin"]', '{"enabled": true, "windowMinutes": 60, "keyFields": []}'),
  ('role-assignment-confirmation', 'Role assignment confirmation', 'You assigned {{targetRole}} to {{targetUserName}}.', '/admin/users', '["TechnicalAdmin"]', '{"enabled": false}'),
  ('model-config-change-confirmation', 'Model/config change confirmation', 'You updated {{configField}}.', '/admin/platform/config', '["TechnicalAdmin"]', '{"enabled": false}')
ON CONFLICT (slug) DO NOTHING;

-- smoke-test reference data (from 0004_seed_reference_data.sql)
INSERT INTO public.department (id, name)
VALUES ('550e8400-e29b-41d4-a716-446655440000'::uuid, 'Test Department')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.document_type (id, department_id, name, access_state)
VALUES ('550e8400-e29b-41d4-a716-446655440001'::uuid, '550e8400-e29b-41d4-a716-446655440000'::uuid, 'Contract', 'OPEN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.document_type_config (document_type_id, tone, density, type_prompt_text)
VALUES ('550e8400-e29b-41d4-a716-446655440001'::uuid, 'professional', 'medium', 'Review this contract for clarity and completeness.')
ON CONFLICT (document_type_id) DO NOTHING;

INSERT INTO public.content_type (id, document_type_id, label)
VALUES ('550e8400-e29b-41d4-a716-446655440002'::uuid, '550e8400-e29b-41d4-a716-446655440001'::uuid, 'Standard')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_metadata_field (id, document_type_id, label, required)
VALUES ('550e8400-e29b-41d4-a716-446655440003'::uuid, '550e8400-e29b-41d4-a716-446655440001'::uuid, 'Party Name', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.error_category (id, document_type_id, name)
VALUES ('550e8400-e29b-41d4-a716-446655440004'::uuid, '550e8400-e29b-41d4-a716-446655440001'::uuid, 'Ambiguity')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- SCHEMA ADDITIONS (from 0035_max_upload_file_size.sql, 0036_max_word_count.sql)
-- ===========================================================================

ALTER TABLE public.platform_usage_policy
    ADD COLUMN IF NOT EXISTS max_upload_file_size_bytes bigint NOT NULL DEFAULT 31457280
        CHECK (max_upload_file_size_bytes >= 1048576 AND max_upload_file_size_bytes <= 1073741824);

ALTER TABLE public.platform_usage_policy
    ADD COLUMN IF NOT EXISTS max_word_count integer NOT NULL DEFAULT 10000
        CHECK (max_word_count >= 100 AND max_word_count <= 100000);
