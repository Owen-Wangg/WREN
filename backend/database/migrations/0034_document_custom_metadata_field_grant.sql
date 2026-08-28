-- Migration 0034 — GRANT SELECT on custom_metadata_field to wren_document.
--
-- POST /v1/documents calls a SELECT on custom_metadata_field to validate
-- required metadata fields for the document type. 0027 omitted this table
-- from wren_document, causing a 500 on every student document upload.

BEGIN;

GRANT SELECT ON TABLE custom_metadata_field TO wren_document;

COMMIT;
