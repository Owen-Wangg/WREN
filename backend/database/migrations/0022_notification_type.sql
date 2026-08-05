-- Migration 0022 — Notification_Type catalog table.
--
-- Extensible, data-driven notification type definitions. New notification
-- categories are INSERT rows, never code-level enumerations. Managed
-- exclusively by TechnicalAdmin (REQ-NOTIF-TYPE-CONFIG-01).

BEGIN;

CREATE TABLE notification_type (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              VARCHAR(100) NOT NULL UNIQUE,
    label             VARCHAR(255) NOT NULL,
    display_template  TEXT NOT NULL,
    action_url_template TEXT,
    target_roles      JSONB NOT NULL DEFAULT '[]',
    dedup_strategy    JSONB NOT NULL DEFAULT '{"enabled": false}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup by slug (most common access pattern from Notification Lambda).
CREATE INDEX idx_notification_type_slug ON notification_type(slug);

COMMIT;
