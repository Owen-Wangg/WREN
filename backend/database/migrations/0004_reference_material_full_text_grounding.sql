-- ===========================================================================
-- 0004_reference_material_full_text_grounding.sql
--
-- Reference grounding is deliberately full-text, not RAG. The Feedback Engine
-- (backend/engine/python/handler.py, load_reference_material) reads the
-- UTF-8 text objects under s3://<reference bucket>/document-types/{id}/ and
-- places them in the prompt, capped by wren_engine.debrief_budget. No
-- embeddings are computed or stored anywhere. This migration removes the
-- schema that implied otherwise and repairs the reference_material tier
-- vocabulary.
--
-- 1. Tier vocabulary. reference_material_tier_check allowed ('org','domain')
--    while reference_material_tier_scope requires ('department','type'). No
--    tier value satisfies both, so every INSERT was rejected. The canonical
--    vocabulary is ('department','type'): it matches reference_material_tier_scope,
--    backend/admin/src/referenceMaterialService.ts, and the shared zod schema.
--    'org' / 'domain' are the pre-V4 names (organization -> department,
--    writing domain -> document type); any legacy row on a pre-squash
--    environment is mapped forward before the constraint is re-added.
--
-- 2. reference_material.embedding_id was never written (no FK, no embedding
--    table, no production caller). Dropped.
--
-- 3. The pgvector extension was installed for an embedding table that was
--    never created. Dropped with the default RESTRICT behaviour: if anything
--    on an environment still depends on it (for example a hand-made vector
--    column), the drop is skipped with a NOTICE instead of cascading data away
--    or failing the deploy.
--
-- Forward-only. Runs in the migration runner's per-file transaction.
-- ===========================================================================

-- 1. Tier vocabulary -------------------------------------------------------

ALTER TABLE public.reference_material
  DROP CONSTRAINT IF EXISTS reference_material_tier_check;

UPDATE public.reference_material SET tier = 'department' WHERE tier = 'org';
UPDATE public.reference_material SET tier = 'type' WHERE tier = 'domain';

ALTER TABLE public.reference_material
  ADD CONSTRAINT reference_material_tier_check
  CHECK (tier = ANY (ARRAY['department'::text, 'type'::text]));

-- 2. Unused embedding linkage ----------------------------------------------

ALTER TABLE public.reference_material
  DROP COLUMN IF EXISTS embedding_id;

-- 3. Unused pgvector extension ---------------------------------------------

DO $$
BEGIN
  DROP EXTENSION IF EXISTS vector;
EXCEPTION
  WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'pgvector left installed: other objects still depend on it.';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pgvector left installed: migration role cannot drop it.';
END $$;
