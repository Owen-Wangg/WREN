/**
 * Browser CORS for aws_proxy Lambda responses.
 *
 * API Gateway MOCK OPTIONS is the preflight gate; these headers must still
 * echo an allowlisted Origin on the actual response or the browser hides it.
 * Allowlist comes from `CORS_ALLOWED_ORIGINS` (comma-separated exact origins)
 * plus Amplify default hosts when `CORS_ALLOW_AMPLIFY_ORIGINS` is not `false`.
 */
import type { APIGatewayProxyResult } from 'aws-lambda';

export const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
export const CORS_ALLOW_HEADERS =
  'Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent';

export const LOCAL_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

/** Amplify default domain: `https://{branch}.{appId}.amplifyapp.com`. */
export const AMPLIFY_APP_ORIGIN_PATTERN =
  /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.amplifyapp\.com$/;

export type CorsEnv = NodeJS.ProcessEnv;

let activeOrigin: string | undefined;

export function parseCorsAllowlist(env: CorsEnv = process.env): string[] {
  const origins = new Set<string>(LOCAL_FRONTEND_ORIGINS);
  for (const part of (env.CORS_ALLOWED_ORIGINS ?? '').split(',')) {
    const origin = part.trim();
    if (origin.length > 0) origins.add(origin);
  }
  return [...origins];
}

export function allowAmplifyAppOrigins(env: CorsEnv = process.env): boolean {
  return env.CORS_ALLOW_AMPLIFY_ORIGINS !== 'false';
}

export function originFromEvent(event: {
  readonly headers?: Record<string, string | undefined> | null;
}): string | undefined {
  const headers = event.headers;
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'origin' && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Remember the request Origin for later `withCorsHeaders` calls in this invocation. */
export function bindCorsOrigin(event: {
  readonly headers?: Record<string, string | undefined> | null;
}): void {
  activeOrigin = originFromEvent(event);
}

export function resolveAllowedOrigin(
  requestOrigin: string | undefined,
  env: CorsEnv = process.env,
): string | undefined {
  if (!requestOrigin) return undefined;
  if (parseCorsAllowlist(env).includes(requestOrigin)) return requestOrigin;
  if (allowAmplifyAppOrigins(env) && AMPLIFY_APP_ORIGIN_PATTERN.test(requestOrigin)) {
    return requestOrigin;
  }
  return undefined;
}

export function corsResponseHeaders(
  requestOrigin: string | undefined = activeOrigin,
  env: CorsEnv = process.env,
): Record<string, string> {
  const allowed = resolveAllowedOrigin(requestOrigin, env);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
  };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = allowed;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function withCorsHeaders(
  result: APIGatewayProxyResult,
  requestOrigin: string | undefined = activeOrigin,
): APIGatewayProxyResult {
  return {
    ...result,
    headers: {
      ...corsResponseHeaders(requestOrigin),
      ...(result.headers as Record<string, string> | undefined),
    },
  };
}
