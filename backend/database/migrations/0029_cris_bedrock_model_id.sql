-- Migration 0029 — prefix stored Bedrock model ids with us. for CRIS.
--
-- Ask WREN / the engine invoke from ca-central-1. IAM allows only
-- us.anthropic.* / us.meta.* inference profiles. A stored
-- anthropic.claude-… id is invoked as a regional foundation model and 403s.

BEGIN;

UPDATE platform_usage_policy
SET bedrock_model_id = 'us.' || bedrock_model_id
WHERE bedrock_model_id LIKE 'anthropic.%'
   OR bedrock_model_id LIKE 'meta.%';

COMMIT;
