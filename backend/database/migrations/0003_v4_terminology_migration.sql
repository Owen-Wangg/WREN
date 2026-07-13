-- Migration 0003 — V4 terminology migration.
--
-- Migrates from V1 terminology (Organization, WritingType, FieldExpert, OrgOwner,
-- Admin, INHERIT access state, org-level grants) to V4 (Department, DocumentType,
-- Student, DepartmentAdmin, TechnicalAdmin, direct OPEN/LOCKED only).
--
-- This is a forward-only schema migration per the V1→V4 mapping table in
-- design.md. It renames tables/columns, collapses role enum values, removes the
-- INHERIT access state, and drops org-level grants.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rename `organization` → `department` (remove access_state column)
-- ---------------------------------------------------------------------------

ALTER TABLE organization RENAME TO department;
ALTER TABLE department DROP COLUMN access_state;

-- ---------------------------------------------------------------------------
-- 2. Rename `writing_type` → `document_type`; organizationId → departmentId;
--    remove INHERIT access state (coerce to LOCKED)
-- ---------------------------------------------------------------------------

ALTER TABLE writing_type RENAME TO document_type;
ALTER TABLE document_type RENAME COLUMN organization_id TO department_id;

-- Coerce any INHERIT rows to LOCKED (V4 has no inheritance; LOCKED is safe default)
UPDATE document_type SET access_state = 'LOCKED' WHERE access_state = 'INHERIT';

-- Tighten the CHECK constraint (remove INHERIT)
ALTER TABLE document_type DROP CONSTRAINT IF EXISTS writing_type_access_state_check;
ALTER TABLE document_type ADD CONSTRAINT document_type_access_state_check
    CHECK (access_state IN ('OPEN', 'LOCKED'));

-- Rename the index
ALTER INDEX IF EXISTS idx_writing_type_org RENAME TO idx_document_type_dept;

-- ---------------------------------------------------------------------------
-- 3. Rename `writing_type_config` → `document_type_config`
-- ---------------------------------------------------------------------------

ALTER TABLE writing_type_config RENAME TO document_type_config;
ALTER TABLE document_type_config RENAME COLUMN writing_type_id TO document_type_id;
ALTER TABLE document_type_config RENAME COLUMN domain_prompt_text TO type_prompt_text;

-- ---------------------------------------------------------------------------
-- 4. Update `error_category`: writing_type_id → document_type_id
-- ---------------------------------------------------------------------------

ALTER TABLE error_category RENAME COLUMN writing_type_id TO document_type_id;
ALTER INDEX IF EXISTS idx_error_category_writing_type RENAME TO idx_error_category_document_type;

-- ---------------------------------------------------------------------------
-- 5. Update `content_type`: writing_type_id → document_type_id
-- ---------------------------------------------------------------------------

ALTER TABLE content_type RENAME COLUMN writing_type_id TO document_type_id;
ALTER INDEX IF EXISTS idx_content_type_writing_type RENAME TO idx_content_type_document_type;

-- ---------------------------------------------------------------------------
-- 6. Update `custom_metadata_field`: writing_type_id → document_type_id
-- ---------------------------------------------------------------------------

ALTER TABLE custom_metadata_field RENAME COLUMN writing_type_id TO document_type_id;
ALTER INDEX IF EXISTS idx_custom_metadata_field_writing_type
    RENAME TO idx_custom_metadata_field_document_type;

-- ---------------------------------------------------------------------------
-- 7. Update `topic`: organization_id → department_id
-- ---------------------------------------------------------------------------

ALTER TABLE topic RENAME COLUMN organization_id TO department_id;
ALTER INDEX IF EXISTS idx_topic_org RENAME TO idx_topic_dept;

-- ---------------------------------------------------------------------------
-- 8. Update `role_assignment`: collapse role values to V4 three-role model
-- ---------------------------------------------------------------------------

-- Collapse FieldExpert/DocumentExpert/OrgOwner → DepartmentAdmin
-- The scope JSON is updated: {writingTypeIds:[...]} or {organizationId:...} → {departmentIds:[...]}
-- For FieldExpert: map each writingTypeId to its document_type's department_id
-- For OrgOwner: map organizationId to the department it became (same id)
UPDATE role_assignment
SET role = 'DepartmentAdmin',
    scope = (
        SELECT jsonb_build_object('departmentIds',
            COALESCE(
                (SELECT jsonb_agg(DISTINCT dt.department_id)
                 FROM document_type dt
                 WHERE dt.id = ANY(
                     SELECT jsonb_array_elements_text(role_assignment.scope->'writingTypeIds')::uuid
                 )),
                '[]'::jsonb
            )
        )
    )
WHERE role = 'Field Expert' AND scope IS NOT NULL AND scope ? 'writingTypeIds';

UPDATE role_assignment
SET role = 'DepartmentAdmin',
    scope = jsonb_build_object('departmentIds',
        jsonb_build_array(scope->>'organizationId'))
WHERE role = 'Org Owner' AND scope IS NOT NULL AND scope ? 'organizationId';

-- Rename 'User' → 'Student', 'Admin' → 'TechnicalAdmin'
UPDATE role_assignment SET role = 'Student' WHERE role = 'User';
UPDATE role_assignment SET role = 'TechnicalAdmin' WHERE role = 'Admin';

-- Any remaining Field Expert / Org Owner with NULL scope → DepartmentAdmin with empty scope
UPDATE role_assignment
SET role = 'DepartmentAdmin', scope = '{"departmentIds":[]}'::jsonb
WHERE role IN ('Field Expert', 'Org Owner', 'Document Expert');

-- Update the CHECK constraint
ALTER TABLE role_assignment DROP CONSTRAINT IF EXISTS role_assignment_role_check;
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_role_check
    CHECK (role IN ('Student', 'DepartmentAdmin', 'TechnicalAdmin'));

-- ---------------------------------------------------------------------------
-- 9. Update `access_grant`: remove org-level grants, flatten scope to
--    document_type_id column
-- ---------------------------------------------------------------------------

-- Add the new flat column
ALTER TABLE access_grant ADD COLUMN document_type_id uuid;

-- Migrate existing grants: extract writingTypeId from scope JSON
UPDATE access_grant
SET document_type_id = (scope->>'writingTypeId')::uuid
WHERE scope ? 'writingTypeId';

-- Delete org-level grants (no V4 equivalent)
DELETE FROM access_grant WHERE scope ? 'organizationId';

-- Safety net: delete any remaining rows whose scope matched neither
-- 'writingTypeId' nor 'organizationId' (malformed/unexpected legacy data).
-- Without this, the NOT NULL constraint below would abort the migration.
DELETE FROM access_grant WHERE document_type_id IS NULL;

-- Drop the JSONB scope column and make document_type_id NOT NULL + FK
ALTER TABLE access_grant DROP COLUMN scope;
ALTER TABLE access_grant ALTER COLUMN document_type_id SET NOT NULL;
ALTER TABLE access_grant ADD CONSTRAINT fk_access_grant_document_type
    FOREIGN KEY (document_type_id) REFERENCES document_type(id) ON DELETE CASCADE;

CREATE INDEX idx_access_grant_document_type ON access_grant(document_type_id);

-- ---------------------------------------------------------------------------
-- 10. Update `reference_material`: org→department, domain→type
-- ---------------------------------------------------------------------------

ALTER TABLE reference_material RENAME COLUMN organization_id TO department_id;
ALTER TABLE reference_material RENAME COLUMN writing_type_id TO document_type_id;

-- Update tier values
UPDATE reference_material SET tier = 'department' WHERE tier = 'org';
UPDATE reference_material SET tier = 'type' WHERE tier = 'domain';

-- Update CHECK constraint
ALTER TABLE reference_material DROP CONSTRAINT IF EXISTS reference_material_tier_scope;
ALTER TABLE reference_material ADD CONSTRAINT reference_material_tier_scope CHECK (
    (tier = 'department' AND department_id IS NOT NULL)
    OR (tier = 'type' AND document_type_id IS NOT NULL)
);

ALTER INDEX IF EXISTS idx_reference_material_org RENAME TO idx_reference_material_dept;
ALTER INDEX IF EXISTS idx_reference_material_writing_type
    RENAME TO idx_reference_material_document_type;

-- ---------------------------------------------------------------------------
-- 11. Update `document`: writing_type_id → document_type_id
-- ---------------------------------------------------------------------------

ALTER TABLE document RENAME COLUMN writing_type_id TO document_type_id;
ALTER INDEX IF EXISTS idx_document_writing_type RENAME TO idx_document_document_type;

-- ---------------------------------------------------------------------------
-- 12. Update `usage_limit` and `usage_counter`: remove 'organization' scope,
--     rename 'writingType' → 'documentType'
-- ---------------------------------------------------------------------------

DELETE FROM usage_limit WHERE scope_kind = 'organization';
UPDATE usage_limit SET scope_kind = 'documentType' WHERE scope_kind = 'writingType';
ALTER TABLE usage_limit DROP CONSTRAINT IF EXISTS usage_limit_scope_kind_check;
ALTER TABLE usage_limit ADD CONSTRAINT usage_limit_scope_kind_check
    CHECK (scope_kind IN ('platform', 'documentType'));

DELETE FROM usage_counter WHERE scope_kind = 'organization';
UPDATE usage_counter SET scope_kind = 'documentType' WHERE scope_kind = 'writingType';
ALTER TABLE usage_counter DROP CONSTRAINT IF EXISTS usage_counter_scope_kind_check;
ALTER TABLE usage_counter ADD CONSTRAINT usage_counter_scope_kind_check
    CHECK (scope_kind IN ('platform', 'documentType'));

-- ---------------------------------------------------------------------------
-- 13. Update `override`: writing_type_id → document_type_id
-- ---------------------------------------------------------------------------

ALTER TABLE override RENAME COLUMN writing_type_id TO document_type_id;

-- ---------------------------------------------------------------------------
-- 14. Update `activity_event`: writing_type_id → document_type_id,
--     organization_id → department_id
-- ---------------------------------------------------------------------------

ALTER TABLE activity_event RENAME COLUMN writing_type_id TO document_type_id;
ALTER TABLE activity_event RENAME COLUMN organization_id TO department_id;

-- Update FK references (they use ON DELETE SET NULL, which stays the same)
-- The FK names may differ by installation, so we drop by column and re-add
ALTER TABLE activity_event DROP CONSTRAINT IF EXISTS activity_event_writing_type_id_fkey;
ALTER TABLE activity_event DROP CONSTRAINT IF EXISTS activity_event_organization_id_fkey;

ALTER TABLE activity_event ADD CONSTRAINT activity_event_document_type_id_fkey
    FOREIGN KEY (document_type_id) REFERENCES document_type(id) ON DELETE SET NULL;
ALTER TABLE activity_event ADD CONSTRAINT activity_event_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES department(id) ON DELETE SET NULL;

COMMIT;
