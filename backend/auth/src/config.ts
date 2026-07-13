/**
 * Environment configuration for the Auth_Service Lambda authorizer.
 *
 * Cognito pool/client identifiers are non-secret configuration supplied as
 * Lambda environment variables by the CDK `Api` stack (see
 * {@link AUTHORIZER_ENV_KEYS}); database credentials are resolved separately by
 * `@wren/db-node` from Secrets Manager at runtime. Nothing here is hardcoded.
 */
import type { CognitoVerifierConfig } from './tokenVerifier';

/** Environment variable names the authorizer reads (wired by the `Api` stack). */
export const AUTHORIZER_ENV_KEYS = {
  userPoolId: 'COGNITO_USER_POOL_ID',
  clientId: 'COGNITO_CLIENT_ID',
  tokenUse: 'COGNITO_TOKEN_USE',
} as const;

export interface AuthorizerEnv {
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
  COGNITO_TOKEN_USE?: string;
}

function requireEnv(env: AuthorizerEnv, key: keyof typeof AUTHORIZER_ENV_KEYS): string {
  const name = AUTHORIZER_ENV_KEYS[key];
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value.trim();
}

/** Resolve the Cognito verifier configuration from the Lambda environment. */
export function resolveCognitoVerifierConfig(
  env: AuthorizerEnv = process.env as AuthorizerEnv,
): CognitoVerifierConfig {
  const tokenUse = env[AUTHORIZER_ENV_KEYS.tokenUse];
  return {
    userPoolId: requireEnv(env, 'userPoolId'),
    clientId: requireEnv(env, 'clientId'),
    tokenUse: tokenUse === 'id' ? 'id' : 'access',
  };
}
