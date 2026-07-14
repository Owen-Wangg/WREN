-- Migration 0004 — seed minimal reference data for smoke testing.
--
-- Adds:
--   - One department (for DepartmentAdmin testing)
--   - One document type (for document submission testing)
--   - One content type (for document creation)
--   - One custom metadata field (for metadata validation testing)
--   - One error category (for feedback taxonomy)
--
-- These are idempotent using ON CONFLICT ... DO NOTHING to prevent duplicate inserts.
-- Reference data can be deleted by tests without affecting schema.

BEGIN;

-- Seed one test department
INSERT INTO department (name)
VALUES ('Test Department')
ON CONFLICT (name) DO NOTHING;

-- Get the test department ID (either from insert or existing)
-- For seed, we'll use a deterministic ID for repeatability
DELETE FROM department WHERE name = 'Test Department' AND id != '550e8400-e29b-41d4-a716-446655440000'::uuid;
INSERT INTO department (id, name)
VALUES ('550e8400-e29b-41d4-a716-446655440000'::uuid, 'Test Department')
ON CONFLICT (id) DO NOTHING;

-- Seed one document type (common contract example)
INSERT INTO document_type (id, department_id, name, access_state)
VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'Contract',
  'OPEN'
)
ON CONFLICT (id) DO NOTHING;

-- Seed document type config
INSERT INTO document_type_config (document_type_id, tone, density, type_prompt_text)
VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'professional',
  'medium',
  'Review this contract for clarity and completeness.'
)
ON CONFLICT (document_type_id) DO NOTHING;

-- Seed one content type
INSERT INTO content_type (id, document_type_id, label)
VALUES (
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'Standard'
)
ON CONFLICT (id) DO NOTHING;

-- Seed one custom metadata field for required field validation testing
INSERT INTO custom_metadata_field (id, document_type_id, label, required)
VALUES (
  '550e8400-e29b-41d4-a716-446655440003'::uuid,
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'Party Name',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Seed one error category for feedback taxonomy
INSERT INTO error_category (id, document_type_id, name)
VALUES (
  '550e8400-e29b-41d4-a716-446655440004'::uuid,
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'Ambiguity'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
