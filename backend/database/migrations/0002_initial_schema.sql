-- Migration 0002 — initial relational schema for WREN Writing Coach.
--
-- Source of truth: design.md "Data Models" (Core Entities + Key Invariants) and
-- tasks.md task 2.3. Naming follows the product decision in tasks.md / the shared
-- /types package: the design's "Writing Domain" entity is implemented here as the
-- configurable, self-selectable `writing_type` (it is DATA, never an enumerated
-- domain set). All other identifiers use snake_case per PostgreSQL convention.
--
-- Schema-level invariants enforced in this migration (task 2.3 + design):
--   1. Drafts are IMMUTABLE — a BEFORE UPDATE trigger rejects any row update
--      (revision creates a new Draft; cascade DELETE is still allowed so a
--      Document delete can remove its Drafts). Requirement 8.1.
--   2. A Feedback Item is linked to its ErrorCategory BY ID (FK), so renaming a
--      category preserves the linkage. Requirement 15.3.
--   3. There is NO `replacement_prose` column on any table (no-ghostwriting).
--      Requirement 11.4 / REQ-CORE-NOGHOST-01.
--   4. `activity_event` is INDEPENDENT of Documents — it holds no foreign key to
--      `document`/`draft`/`feedback_item`, so deleting a Document never deletes
--      activity-log events. Requirement 44.2.
--   5. Organizations are GROUPINGS, not tenants, and own no Users; Users
--      (`app_user`) are global. Requirements 28.1 / 28.2.
--   6. Deleting a Document cascades to its operational state (Drafts, Anchors,
--      Feedback Items, resolution history) but NOT to ActivityEvent /
--      AggregateCounter (retention partitioning). Requirements 44.2 / 45.x.

BEGIN;

-- ---------------------------------------------------------------------------
-- Identity & authorization
-- ---------------------------------------------------------------------------

-- Organizations are groupings of Writing Types + the experts who maintain them.
-- They own NO Users (Requirement 28.1) and are not a data-isolation boundary.
CREATE TABLE organization (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    -- Effective submission control for contained Writing Types that INHERIT.
    access_state text NOT NULL DEFAULT 'LOCKED'
                 CHECK (access_state IN ('OPEN', 'LOCKED')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Global User. Not owned by any Organization (Requirement 28.2). `idp_subject`
-- (Cognito sub) is used for authentication mapping ONLY; it is never an
-- authorization source of truth.
CREATE TABLE app_user (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL UNIQUE,
    first_name  text NOT NULL,
    last_name   text NOT NULL,
    idp_subject text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Authorization source of truth. `role` is a fixed set of stored identities
-- (Requirement 1.1). `scope` is JSONB: NULL for global roles, {organizationId}
-- for Org Owner, {writingTypeIds:[...]} for Field Expert.
CREATE TABLE role_assignment (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role       text NOT NULL
               CHECK (role IN ('User', 'Field Expert', 'Org Owner', 'Admin')),
    scope      jsonb,
    granted_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_role_assignment_user ON role_assignment(user_id);

-- ---------------------------------------------------------------------------
-- Configurable Writing Type catalog (design "Writing Domain") + its config
-- ---------------------------------------------------------------------------

-- A Writing Type is configurable, self-selectable DATA — never a hardcoded
-- domain enumeration. `access_state` of INHERIT defers to the Organization's
-- access_state; OPEN/LOCKED override it (Requirement 4.1, modelled here).
CREATE TABLE writing_type (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    name            text NOT NULL,
    access_state    text NOT NULL DEFAULT 'INHERIT'
                    CHECK (access_state IN ('OPEN', 'LOCKED', 'INHERIT')),
    -- NULL → inherit the Organization / platform default size limit.
    size_limit_words integer
                     CHECK (size_limit_words IS NULL OR size_limit_words > 0),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_writing_type_org ON writing_type(organization_id);

-- 1:1 configuration record. `updated_at` drives carry-forward invalidation
-- (design: Feedback Engine reuses prior items unless governing config changed).
CREATE TABLE writing_type_config (
    writing_type_id   uuid PRIMARY KEY
                      REFERENCES writing_type(id) ON DELETE CASCADE,
    tone              text,
    -- low | medium | high | items-per-N-words (free-form; not an enum).
    density           text,
    -- Ordered array of error_category ids (priority order).
    category_priority jsonb NOT NULL DEFAULT '[]'::jsonb,
    domain_prompt_text text,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Configurable taxonomy (NOT an enum). Rename updates `name` while preserving
-- `id`; Feedback Items link by `id` so the link survives a rename (Req 15.3).
CREATE TABLE error_category (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    writing_type_id   uuid NOT NULL REFERENCES writing_type(id) ON DELETE CASCADE,
    name              text NOT NULL,
    -- Detection aid for the engine; NEVER surfaced to the User (Req 11.4 / 15.4).
    internal_guidance text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (writing_type_id, name)
);

CREATE INDEX idx_error_category_writing_type ON error_category(writing_type_id);

-- Org-Owner-defined content types, scoped to a Writing Type.
CREATE TABLE content_type (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    writing_type_id uuid NOT NULL REFERENCES writing_type(id) ON DELETE CASCADE,
    label           text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_type_writing_type ON content_type(writing_type_id);

-- Configurable custom metadata fields with a required/optional flag
-- (e.g. the seeded "Writing Topic" field).
CREATE TABLE custom_metadata_field (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    writing_type_id uuid NOT NULL REFERENCES writing_type(id) ON DELETE CASCADE,
    label           text NOT NULL,
    required        boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_metadata_field_writing_type
    ON custom_metadata_field(writing_type_id);

-- Business Topics scoped to one owned Organization. Topics never drive
-- taxonomy/feedback (design / Requirement 35.x).
CREATE TABLE topic (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    name            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_topic_org ON topic(organization_id);

-- ---------------------------------------------------------------------------
-- Access grants (associate a global User with a LOCKED scope, no ownership)
-- ---------------------------------------------------------------------------

CREATE TABLE access_grant (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    -- {writingTypeId:...} or {organizationId:...}
    scope      jsonb NOT NULL,
    granted_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE INDEX idx_access_grant_user ON access_grant(user_id);

-- ---------------------------------------------------------------------------
-- Reference Material (two-tier) — created before feedback_item so a Feedback
-- Item can cite a source by id. Holds NO replacement prose.
-- ---------------------------------------------------------------------------

CREATE TABLE reference_material (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- tier 1 = org-wide; tier 2 = Writing-Type-scoped (domain).
    tier            text NOT NULL CHECK (tier IN ('org', 'domain')),
    organization_id uuid REFERENCES organization(id) ON DELETE CASCADE,
    writing_type_id uuid REFERENCES writing_type(id) ON DELETE CASCADE,
    title           text NOT NULL,
    section         text,
    content_kind    text NOT NULL CHECK (content_kind IN ('file', 'text', 'html')),
    s3_key          text,
    inline_content  text,
    -- Points at a pgvector embedding row (populated by reference-grounding work).
    embedding_id    uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- An org-wide reference is scoped to an Organization; a domain reference is
    -- scoped to a Writing Type. The scope id for the tier must be present.
    CONSTRAINT reference_material_tier_scope CHECK (
        (tier = 'org' AND organization_id IS NOT NULL)
        OR (tier = 'domain' AND writing_type_id IS NOT NULL)
    )
);

CREATE INDEX idx_reference_material_org ON reference_material(organization_id);
CREATE INDEX idx_reference_material_writing_type
    ON reference_material(writing_type_id);

-- ---------------------------------------------------------------------------
-- Documents, immutable Drafts, Feedback Items, Anchors, resolution history
-- ---------------------------------------------------------------------------

-- A Document is owned by a global User and scoped to a Writing Type. Deleting a
-- Writing Type with documents is RESTRICTed (requires the confirmation/impact
-- flow in the Admin service, task 5.2) rather than silently cascading.
CREATE TABLE document (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    writing_type_id uuid NOT NULL REFERENCES writing_type(id) ON DELETE RESTRICT,
    content_type_id uuid REFERENCES content_type(id) ON DELETE SET NULL,
    name            text NOT NULL,
    -- Custom metadata field values keyed by field id/label (JSONB).
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Extensible status enum (e.g. 'Still Drafting' | 'Polishing'); intentionally
    -- not constrained so new statuses can be added without a migration.
    status          text NOT NULL DEFAULT 'Still Drafting',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_owner ON document(owner_user_id);
CREATE INDEX idx_document_writing_type ON document(writing_type_id);

-- A Draft is IMMUTABLE and chronologically versioned. The highest version_number
-- per Document is the current Draft. Cascades when its Document is deleted.
CREATE TABLE draft (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id    uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    version_number integer NOT NULL CHECK (version_number > 0),
    s3_key         text NOT NULL,
    -- Ordered paragraph segments with stable indices (anchoring/diff substrate).
    segments       jsonb NOT NULL,
    word_count     integer NOT NULL CHECK (word_count >= 0),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, version_number)
);

CREATE INDEX idx_draft_document ON draft(document_id);

-- A Feedback Item NEVER contains replacement prose. It links to its
-- ErrorCategory by id (rename-safe). `current_anchor_id` FK is added after the
-- anchor table exists (the two tables reference each other).
CREATE TABLE feedback_item (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id           uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    error_category_id     uuid NOT NULL
                          REFERENCES error_category(id) ON DELETE RESTRICT,
    kind                  text NOT NULL CHECK (kind IN ('inline', 'structural')),
    -- The Socratic question / error-type flag shown to the writer.
    question_text         text NOT NULL,
    current_anchor_id     uuid,
    citation_reference_id uuid REFERENCES reference_material(id) ON DELETE SET NULL,
    source_draft_id       uuid NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
    created_at            timestamptz NOT NULL DEFAULT now()
    -- INVARIANT: there is deliberately no `replacement_prose` column here or on
    -- any other table (REQ-CORE-NOGHOST-01 / Requirement 11.4).
);

CREATE INDEX idx_feedback_item_document ON feedback_item(document_id);
CREATE INDEX idx_feedback_item_category ON feedback_item(error_category_id);

-- An Anchor ties a Feedback Item to a text span on a specific Draft. It carries
-- positional + content-fingerprint data so it can be re-mapped via diff, and is
-- marked `removed` rather than mis-attached when its span disappears.
CREATE TABLE anchor (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_item_id    uuid NOT NULL REFERENCES feedback_item(id) ON DELETE CASCADE,
    draft_id            uuid NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
    paragraph_index     integer NOT NULL CHECK (paragraph_index >= 0),
    start_offset        integer NOT NULL CHECK (start_offset >= 0),
    end_offset          integer NOT NULL CHECK (end_offset >= 0),
    -- Normalized text hash + bounded surrounding context.
    content_fingerprint text NOT NULL,
    state               text NOT NULL DEFAULT 'active'
                        CHECK (state IN ('active', 'removed')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT anchor_offset_order CHECK (end_offset >= start_offset)
);

CREATE INDEX idx_anchor_feedback_item ON anchor(feedback_item_id);
CREATE INDEX idx_anchor_draft ON anchor(draft_id);

-- Now that `anchor` exists, close the Feedback Item → current Anchor link.
ALTER TABLE feedback_item
    ADD CONSTRAINT fk_feedback_item_current_anchor
    FOREIGN KEY (current_anchor_id) REFERENCES anchor(id) ON DELETE SET NULL;

-- Append-only resolution history: exactly one status per (item, draft). A
-- BEFORE UPDATE trigger (below) blocks mutation; cascade DELETE is still allowed.
CREATE TABLE resolution_status_history (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_item_id uuid NOT NULL REFERENCES feedback_item(id) ON DELETE CASCADE,
    draft_id         uuid NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
    status           text NOT NULL CHECK (status IN (
                         'resolved', 'partially_resolved', 'still_unresolved',
                         'removed', 'unchanged')),
    evaluated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (feedback_item_id, draft_id)
);

CREATE INDEX idx_resolution_history_item ON resolution_status_history(feedback_item_id);

-- ---------------------------------------------------------------------------
-- Usage limits, counters, and temporary overrides
-- ---------------------------------------------------------------------------

CREATE TABLE usage_limit (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_kind  text NOT NULL
                CHECK (scope_kind IN ('platform', 'organization', 'writingType')),
    scope_id    uuid,
    limit_value integer NOT NULL CHECK (limit_value >= 0),
    period      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_counter (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_kind   text NOT NULL
                 CHECK (scope_kind IN ('platform', 'organization', 'writingType')),
    scope_id     uuid,
    period_start timestamptz NOT NULL,
    consumed     integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
    UNIQUE (scope_kind, scope_id, period_start)
);

-- Temporary, Writing-Type-scoped usage override (audited; expires on reset).
CREATE TABLE override (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    writing_type_id uuid NOT NULL REFERENCES writing_type(id) ON DELETE CASCADE,
    bounds          jsonb NOT NULL,
    reason          text NOT NULL,
    granted_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_override_user ON override(user_id);

-- ---------------------------------------------------------------------------
-- Audit / analytics — INDEPENDENT of Documents (survive document deletion)
-- ---------------------------------------------------------------------------

-- Actor–Verb–Object activity log. Persisted independently of document content:
-- there is NO foreign key to document/draft/feedback_item, so deleting a
-- Document never deletes these events (Requirement 44.2). Optional scope FKs to
-- writing_type/organization use ON DELETE SET NULL to preserve the event while
-- clearing a removed scope. `context` holds structured data, never raw document
-- content; `actor_pseudonym` is a stable de-identified actor id.
CREATE TABLE activity_event (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_pseudonym text NOT NULL,
    verb            text NOT NULL,
    object_type     text NOT NULL,
    object_ref      text NOT NULL,
    writing_type_id uuid REFERENCES writing_type(id) ON DELETE SET NULL,
    organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
    "timestamp"     timestamptz NOT NULL DEFAULT now(),
    context         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_activity_event_timestamp ON activity_event("timestamp");

-- All-users aggregate read model for analytics. Never per-User; retained across
-- document deletion.
CREATE TABLE aggregate_counter (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_kind   text NOT NULL,
    scope_id     uuid,
    metric       text NOT NULL,
    window_start timestamptz NOT NULL,
    value        bigint NOT NULL DEFAULT 0,
    UNIQUE (scope_kind, scope_id, metric, window_start)
);

-- ---------------------------------------------------------------------------
-- Immutability / append-only enforcement triggers
-- ---------------------------------------------------------------------------

-- Reject any attempt to UPDATE a Draft row. Drafts are immutable: a revision is
-- a brand-new Draft (Requirement 8.1). DELETE is intentionally NOT blocked so a
-- Document deletion can cascade to its Drafts.
CREATE OR REPLACE FUNCTION reject_draft_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Draft rows are immutable (id=%); create a new Draft instead.', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draft_immutable
    BEFORE UPDATE ON draft
    FOR EACH ROW EXECUTE FUNCTION reject_draft_update();

-- Reject any attempt to UPDATE a resolution-history row. History is append-only
-- (Requirement 17.6); a re-evaluation inserts a new (item, draft) row.
CREATE OR REPLACE FUNCTION reject_resolution_history_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'resolution_status_history is append-only (id=%).', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resolution_status_history_append_only
    BEFORE UPDATE ON resolution_status_history
    FOR EACH ROW EXECUTE FUNCTION reject_resolution_history_update();

COMMIT;
