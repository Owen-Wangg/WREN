-- Migration 0006 — Add dept-admin customizable prompt fields to writing_type_config.
--
-- Allows dept admins to customize feedback prompts per document type:
--   - type_prompt_text: System prompt scaffold for WREN coaching persona
--   - tone_description: Guidance on tone for feedback (e.g., "Be supportive")
--   - density_description: Guidance on feedback density
--
-- These are combined with category_priority to filter which feedback types are active.
-- The Feedback Engine reads these fields when assembling the prompt for Bedrock.

BEGIN;

-- Add new prompt customization columns to writing_type_config
ALTER TABLE writing_type_config
    ADD COLUMN type_prompt_text text,
    ADD COLUMN tone_description text,
    ADD COLUMN density_description text;

-- Set sensible defaults for existing rows (migration-safe)
UPDATE writing_type_config
SET
    type_prompt_text = 'You are WREN, a Socratic writing coach. Your role is to guide writers toward excellence through thoughtful questions rather than direct answers.',
    tone_description = 'Be supportive and encouraging while maintaining high expectations.',
    density_description = 'Provide feedback across multiple dimensions of writing quality, focusing on the most impactful improvements.'
WHERE type_prompt_text IS NULL;

COMMIT;
