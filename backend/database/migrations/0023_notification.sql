-- Migration 0023 — Notification table and supporting indexes.
--
-- One row per recipient per event. Lifecycle: unread → read → dismissed.
-- Deduplication enforced by a partial unique index on dedup_key.
-- (REQ-NOTIF-DATA-01, REQ-NOTIF-DEDUP-01)

BEGIN;

CREATE TABLE notification (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_type_id UUID NOT NULL REFERENCES notification_type(id),
    recipient_user_id    UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    state                VARCHAR(20) NOT NULL DEFAULT 'unread'
                         CHECK (state IN ('unread', 'read', 'dismissed')),
    rendered_content     TEXT NOT NULL,
    action_url           TEXT,
    dedup_key            VARCHAR(512),
    context              JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at              TIMESTAMPTZ,
    dismissed_at         TIMESTAMPTZ
);

-- Primary inbox query: user's non-dismissed notifications, newest first.
CREATE INDEX idx_notification_inbox
    ON notification(recipient_user_id, created_at DESC)
    WHERE state != 'dismissed';

-- Unread count for badge display.
CREATE INDEX idx_notification_unread
    ON notification(recipient_user_id)
    WHERE state = 'unread';

-- Deduplication: at most one active notification per dedup_key.
CREATE UNIQUE INDEX idx_notification_dedup
    ON notification(dedup_key)
    WHERE dedup_key IS NOT NULL AND state != 'dismissed';

COMMIT;
