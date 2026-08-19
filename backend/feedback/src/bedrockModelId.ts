/**
 * Resolve the Bedrock model id for Ask WREN: SSM when STACK_PREFIX is set,
 * otherwise BEDROCK_MODEL_ID (local/test fallback). No in-code default model.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const client = new SSMClient({});

export async function resolveBedrockModelId(explicit?: string): Promise<string> {
  const fromCaller = explicit?.trim();
  if (fromCaller) return fromCaller;

  const prefix = process.env.STACK_PREFIX?.trim();
  if (prefix) {
    const name = `/${prefix}/config/bedrock-model-id`;
    const response = await client.send(new GetParameterCommand({ Name: name }));
    const value = response.Parameter?.Value?.trim();
    if (value) return value;
    throw new Error(`SSM parameter ${name} is empty`);
  }

  const fromEnv = process.env.BEDROCK_MODEL_ID?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    'Cannot resolve the Bedrock model id: neither STACK_PREFIX nor BEDROCK_MODEL_ID is set',
  );
}
