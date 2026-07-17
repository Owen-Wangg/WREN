-- Migration 0006 — Add dept-admin customizable prompt fields to document_type_config.
--
-- Allows dept admins to customize feedback prompts per document type:
--   - tone_description: Guidance on tone for feedback (e.g., "Be supportive")
--   - density_description: Guidance on feedback density
--
-- Note: type_prompt_text already exists (renamed from domain_prompt_text in 0003).
-- These are combined with category_priority to filter which feedback types are active.
-- The Feedback Engine reads these fields when assembling the prompt for Bedrock.

BEGIN;

-- Add new prompt customization columns (type_prompt_text already exists from 0003 rename)
ALTER TABLE document_type_config
    ADD COLUMN IF NOT EXISTS tone_description text,
    ADD COLUMN IF NOT EXISTS density_description text;

-- Set sensible defaults for existing rows
UPDATE document_type_config
SET
    type_prompt_text = COALESCE(type_prompt_text, 'You are WREN, a Socratic writing coach. Your role is to guide writers toward excellence through thoughtful questions rather than direct answers.'),
    tone_description = COALESCE(tone_description, 'Be supportive and encouraging while maintaining high expectations.'),
    density_description = COALESCE(density_description, 'Provide feedback across multiple dimensions of writing quality, focusing on the most impactful improvements.')
WHERE tone_description IS NULL OR density_description IS NULL;

COMMIT;
