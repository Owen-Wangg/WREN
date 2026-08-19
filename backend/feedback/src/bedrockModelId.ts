/**
 * Resolve the Bedrock model id for Ask WREN: SSM when STACK_PREFIX is set,
 * otherwise BEDROCK_MODEL_ID (local/test fallback). No in-code default model.
 *
 * Stored admin overrides sometimes omit the CRIS `us.` prefix; IAM only
 * allows `us.anthropic.*` / `us.meta.*` inference profiles from ca-central-1.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const client = new SSMClient({});

/**
 * Map a bare Anthropic/Meta foundation-model id to the US cross-region
 * inference profile id our Lambdas are authorized to invoke.
 */
export function toCrossRegionInferenceProfileId(modelId: string): string {
  const id = modelId.trim();
  if (
    id.startsWith('us.') ||
    id.startsWith('eu.') ||
    id.startsWith('apac.')
  ) {
    return id;
  }
  if (id.startsWith('anthropic.') || id.startsWith('meta.')) {
    return `us.${id}`;
  }
  return id;
}

export async function resolveBedrockModelId(explicit?: string): Promise<string> {
  const fromCaller = explicit?.trim();
  if (fromCaller) return toCrossRegionInferenceProfileId(fromCaller);

  const prefix = process.env.STACK_PREFIX?.trim();
  if (prefix) {
    const name = `/${prefix}/config/bedrock-model-id`;
    const response = await client.send(new GetParameterCommand({ Name: name }));
    const value = response.Parameter?.Value?.trim();
    if (value) return toCrossRegionInferenceProfileId(value);
    throw new Error(`SSM parameter ${name} is empty`);
  }

  const fromEnv = process.env.BEDROCK_MODEL_ID?.trim();
  if (fromEnv) return toCrossRegionInferenceProfileId(fromEnv);

  throw new Error(
    'Cannot resolve the Bedrock model id: neither STACK_PREFIX nor BEDROCK_MODEL_ID is set',
  );
}
