/**
 * Runtime read/write of the Bedrock model id SSM parameter
 * (`/${STACK_PREFIX}/config/bedrock-model-id`).
 */
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

const client = new SSMClient({});

export function bedrockModelIdParameterNameFromEnv(): string {
  const prefix = process.env.STACK_PREFIX?.trim();
  if (!prefix) {
    throw new Error('STACK_PREFIX is not configured — cannot resolve the Bedrock model SSM parameter');
  }
  return `/${prefix}/config/bedrock-model-id`;
}

export async function getBedrockModelIdFromSsm(): Promise<string | null> {
  try {
    const response = await client.send(
      new GetParameterCommand({ Name: bedrockModelIdParameterNameFromEnv() }),
    );
    const value = response.Parameter?.Value?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function putBedrockModelIdToSsm(modelId: string): Promise<void> {
  await client.send(
    new PutParameterCommand({
      Name: bedrockModelIdParameterNameFromEnv(),
      Value: modelId,
      Type: 'String',
      Overwrite: true,
    }),
  );
}
