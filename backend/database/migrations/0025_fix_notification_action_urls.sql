-- Migration 0025 — Fix notification_type action_url_template paths.
--
-- The original seed (0024) used /documents/{{documentId}}/debrief which does
-- not match the frontend routing (/dashboard/document/{{documentId}}).
-- This corrects Student-facing document-related notification types.

BEGIN;

UPDATE notification_type
SET action_url_template = '/dashboard/document/{{documentId}}'
WHERE slug = 'ai-debrief-ready';

UPDATE notification_type
SET action_url_template = '/dashboard/document/{{documentId}}'
WHERE slug = 'ai-debrief-failed';

COMMIT;
