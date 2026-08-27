-- Migration 0033 — let the Document service independently verify active grants.
--
-- The REST authorizer supplies current grants, but POST /v1/documents also
-- re-checks access_grant directly so a locked submission never relies solely
-- on serialized authorizer context. Read-only access is sufficient.

BEGIN;

GRANT SELECT ON TABLE access_grant TO wren_document;

COMMIT;
