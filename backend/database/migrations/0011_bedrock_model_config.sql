-- Migration 0011 — Runtime Bedrock model selection (System Admin configurable).
--
-- Adds bedrock_model_id to platform_usage_policy so TechnicalAdmins can
-- switch the active Claude model at runtime without a redeploy.
-- NULL means "use the BEDROCK_MODEL_ID environment variable" (deploy-time default).

BEGIN;

ALTER TABLE platform_usage_policy
    ADD COLUMN IF NOT EXISTS bedrock_model_id text;

COMMIT;
