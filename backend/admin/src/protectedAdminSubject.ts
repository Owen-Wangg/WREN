/**
 * Resolves the Cognito `sub` of the first (bootstrap) TechnicalAdmin, which
 * must never be demoted through the application.
 *
 * The permanent source of truth is the dedicated protected-admin SSM parameter
 * (`/${STACK_PREFIX}/auth/protected-admin-subject`). The guided deploy's disarm
 * step writes it before removing the transient bootstrap-arming parameter, so
 * demotion protection outlives the one-time elevation gate. For deployments
 * armed before the dedicated parameter existed, this falls back to the legacy
 * bootstrap-arming parameter (`.../technical-admin-bootstrap-subject`), which is
 * still present until the operator disarms.
 *
 * Both are read at runtime rather than from a Lambda env var because ordinary
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

function requirePrefix(): string {
  const prefix = process.env.STACK_PREFIX?.trim();
  if (!prefix) {
    throw new Error(
      'STACK_PREFIX is not configured — cannot resolve the protected first-admin subject',
    );
  }
  return prefix;
}

/** The permanent protected-admin parameter name. */
export function protectedAdminSubjectParameterName(): string {
  return `/${requirePrefix()}/auth/protected-admin-subject`;
}

/** The legacy bootstrap-arming parameter name, used as a fallback source. */
export function bootstrapArmingSubjectParameterName(): string {
  return `/${requirePrefix()}/auth/technical-admin-bootstrap-subject`;
}

/**
 * Read one SSM parameter, returning its trimmed non-`none` value, `null` when
 * the parameter is absent, and propagating any other error (fail-closed).
 */
async function readSubjectParameter(name: string): Promise<string | null> {
  client ??= new SSMClient({});
  try {
    const response = await client.send(new GetParameterCommand({ Name: name }));
    const raw = response.Parameter?.Value?.trim();
    return raw && raw.toLowerCase() !== 'none' ? raw : null;
  } catch (error) {
    if (error instanceof ParameterNotFound) return null;
    throw error;
  }
}

/** Default loader for the deployed Admin Lambda (cached per warm container). */
export const loadProtectedAdminSubject: ProtectedAdminSubjectLoader = async () => {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  // Prefer the permanent record; fall back to the legacy arming parameter for
  // deployments that have not been disarmed since this parameter was introduced.
  const value =
    (await readSubjectParameter(protectedAdminSubjectParameterName())) ??
    (await readSubjectParameter(bootstrapArmingSubjectParameterName()));

  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
};
