/**
 * Resolves the Cognito `sub` of the first (bootstrap) TechnicalAdmin, which
 * must never be demoted through the application.
 *
 * Source of truth is the SSM parameter the guided deploy writes when it arms
 * first-admin bootstrap (`/${STACK_PREFIX}/auth/technical-admin-bootstrap-subject`,
 * see `ssmParameterNames.technicalAdminBootstrapSubject` in `cdk/lib/config.ts`).
 * It is read at runtime rather than from a Lambda env var because ordinary
 * Compute redeploys do not re-pass the bootstrap context, which would silently
 * drop the protection.
 *
 * Fail-closed: any error other than "parameter not found" propagates, so a
 * misconfigured or unreachable SSM blocks TechnicalAdmin revocation instead of
 * allowing it.
 */
import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';

/** Returns the protected subject, or `null` when no first admin is recorded. */
export type ProtectedAdminSubjectLoader = () => Promise<string | null>;

const CACHE_TTL_MS = 60_000;

let client: SSMClient | undefined;
let cached: { value: string | null; expiresAt: number } | undefined;

export function protectedAdminSubjectParameterName(): string {
  const prefix = process.env.STACK_PREFIX?.trim();
  if (!prefix) {
    throw new Error(
      'STACK_PREFIX is not configured — cannot resolve the protected first-admin subject',
    );
  }
  return `/${prefix}/auth/technical-admin-bootstrap-subject`;
}

/** Default loader for the deployed Admin Lambda (cached per warm container). */
export const loadProtectedAdminSubject: ProtectedAdminSubjectLoader = async () => {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  client ??= new SSMClient({});
  let value: string | null;
  try {
    const response = await client.send(
      new GetParameterCommand({ Name: protectedAdminSubjectParameterName() }),
    );
    const raw = response.Parameter?.Value?.trim();
    value = raw && raw.toLowerCase() !== 'none' ? raw : null;
  } catch (error) {
    if (error instanceof ParameterNotFound) {
      value = null;
    } else {
      throw error;
    }
  }

  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
};
