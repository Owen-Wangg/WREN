-- Migration 0028 — GRANT SELECT on platform_usage_policy to wren_document.
--
-- POST /v1/documents calls assertDocumentUploadAllowed, which SELECTs the
-- lifetime cap row. 0027 omitted this table from wren_document.

BEGIN;

GRANT SELECT ON TABLE platform_usage_policy TO wren_document;

COMMIT;
