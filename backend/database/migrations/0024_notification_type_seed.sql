-- Migration 0024 — Seed notification_type catalog with initial 19 types.
--
-- All Student-targeted templates are qualitative only (no numeric scores/counts)
-- per REQ-NOTIF-NOLEAK-01. Dedup is enabled for threshold/repeat-trigger types.
-- (REQ-NOTIF-TYPE-CONFIG-01, REQ-NOTIF-STUDENT-01, REQ-NOTIF-DEPTADMIN-01,
--  REQ-NOTIF-TECHADMIN-01)

BEGIN;

-- ===== Student-facing types =====

INSERT INTO notification_type (slug, label, display_template, action_url_template, target_roles, dedup_strategy)
VALUES
  ('ai-debrief-ready',
   'AI Debrief ready',
   'Your feedback for "{{documentName}}" is ready to review.',
   '/documents/{{documentId}}/debrief',
   '["Student"]',
   '{"enabled": false}'),

  ('ai-debrief-failed',
   'AI Debrief failed',
   'Feedback generation for "{{documentName}}" encountered an issue. You can retry.',
   '/documents/{{documentId}}',
   '["Student"]',
   '{"enabled": true, "windowMinutes": 5, "keyFields": ["documentId", "draftId"]}'),

  ('access-grant-approved',
   'Access grant approved',
   'Your access request for {{documentTypeName}} has been approved.',
   '/documents',
   '["Student"]',
   '{"enabled": false}'),

  ('access-grant-denied',
   'Access grant denied',
   'Your access request for {{documentTypeName}} was not approved.',
   NULL,
   '["Student"]',
   '{"enabled": false}'),

  ('usage-limit-warning',
   'Usage limit warning',
   'You''re approaching the usage limit for {{scopeName}}.',
   NULL,
   '["Student"]',
   '{"enabled": true, "windowMinutes": 1440, "keyFields": ["scopeName"]}'),

  ('usage-limit-reached',
   'Usage limit reached',
   'You''ve reached the usage limit for {{scopeName}}.',
   NULL,
   '["Student"]',
   '{"enabled": true, "windowMinutes": 1440, "keyFields": ["scopeName"]}'),

  ('temporary-override-granted',
   'Temporary override granted',
   'You''ve been granted additional usage for {{documentTypeName}}.',
   '/documents',
   '["Student"]',
   '{"enabled": false}');

-- ===== Department Admin-facing types =====

INSERT INTO notification_type (slug, label, display_template, action_url_template, target_roles, dedup_strategy)
VALUES
  ('access-request-pending',
   'Access request pending',
   '{{studentName}} has requested access to {{documentTypeName}}.',
   '/admin/access-requests',
   '["DepartmentAdmin"]',
   '{"enabled": false}'),

  ('usage-limit-reached-doctype',
   'Usage limit reached (Doc Type)',
   '{{documentTypeName}} has reached its usage limit.',
   '/admin/usage',
   '["DepartmentAdmin"]',
   '{"enabled": true, "windowMinutes": 1440, "keyFields": ["documentTypeId"]}'),

  ('guardrail-violation-flagged',
   'Guardrail violation flagged',
   'A guardrail violation was flagged for {{documentTypeName}}.',
   '/admin/guardrails',
   '["DepartmentAdmin"]',
   '{"enabled": true, "windowMinutes": 60, "keyFields": ["documentTypeId"]}'),

  ('new-department-appointment',
   'New Department appointment',
   'You''ve been appointed to administer {{departmentName}}.',
   '/admin/dashboard',
   '["DepartmentAdmin"]',
   '{"enabled": false}'),

  ('reference-material-failed',
   'Reference material processing failed',
   'Reference material "{{materialTitle}}" for {{documentTypeName}} failed to process.',
   '/admin/reference-materials',
   '["DepartmentAdmin"]',
   '{"enabled": false}'),

  ('override-expiring',
   'Override expiring',
   'An override you granted for {{studentName}} in {{documentTypeName}} expires soon.',
   '/admin/overrides',
   '["DepartmentAdmin"]',
   '{"enabled": true, "windowMinutes": 720, "keyFields": ["overrideId"]}'),

  ('override-expired',
   'Override expired',
   'An override you granted for {{studentName}} in {{documentTypeName}} has expired.',
   '/admin/overrides',
   '["DepartmentAdmin"]',
   '{"enabled": true, "windowMinutes": 1440, "keyFields": ["overrideId"]}');

-- ===== Technical Admin-facing types =====

INSERT INTO notification_type (slug, label, display_template, action_url_template, target_roles, dedup_strategy)
VALUES
  ('usage-limit-reached-platform',
   'Usage limit reached (platform)',
   'The platform-wide usage limit has been reached.',
   '/admin/platform/usage',
   '["TechnicalAdmin"]',
   '{"enabled": true, "windowMinutes": 1440, "keyFields": []}'),

  ('feedback-job-failures',
   'Feedback job failures',
   'DLQ depth has exceeded the configured threshold ({{count}} messages).',
   '/admin/platform/jobs',
   '["TechnicalAdmin"]',
   '{"enabled": true, "windowMinutes": 60, "keyFields": []}'),

  ('guardrail-violation-spike',
   'Guardrail violation spike',
   'Guardrail rejection rate has exceeded the anomaly threshold.',
   '/admin/platform/guardrails',
   '["TechnicalAdmin"]',
   '{"enabled": true, "windowMinutes": 60, "keyFields": []}'),

  ('role-assignment-confirmation',
   'Role assignment confirmation',
   'You assigned {{targetRole}} to {{targetUserName}}.',
   '/admin/users',
   '["TechnicalAdmin"]',
   '{"enabled": false}'),

  ('model-config-change-confirmation',
   'Model/config change confirmation',
   'You updated {{configField}}.',
   '/admin/platform/config',
   '["TechnicalAdmin"]',
   '{"enabled": false}');

COMMIT;
