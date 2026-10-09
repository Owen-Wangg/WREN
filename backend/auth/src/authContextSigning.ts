/**
 * HMAC signing/verification for the API Gateway authorizer context.
 *
 * Why this exists (finding f-140e2506): service Lambdas take their caller
 * identity entirely from `event.requestContext.authorizer`, which only API
 * Gateway populates on the authenticated path. A principal able to invoke a
 * service function directly (`lambda:InvokeFunction`) can hand-build an event
 * with `roles: ["TechnicalAdmin"]` and impersonate anyone — no token in the
 * path. Re-reading roles from the DB does not help, because the attacker also
 * controls `userId`.
 *
 * The fix binds the authorizer context to a shared secret that only the
 * authorizer and the service functions hold (via Secrets Manager, never in the
 * event): the authorizer signs the serialized context with HMAC-SHA256; each
 * service recomputes the MAC over the fields it received and rejects on
 * mismatch. A forged context carries no valid signature, so it is denied.
 *
 * The secret travels authorizer -> API Gateway -> service as an *absent* value:
 * only the HMAC (`sig`) rides in the context, so logging the event never leaks
 * the key.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

/** Env var carrying the name/ARN of the signing secret (value, never the key, is fetched at runtime). */
export const AUTH_CONTEXT_SIGNING_SECRET_ENV = 'AUTH_CONTEXT_SIGNING_SECRET_ID';
/** Env var selecting enforcement mode. Unset or any value other than `permissive` means `enforce`. */
export const AUTH_CONTEXT_VERIFY_MODE_ENV = 'AUTH_CONTEXT_VERIFY_MODE';
/** The context field the signature is carried in. */
export const AUTH_CONTEXT_SIG_FIELD = 'sig';

/**
 * The authorizer-context fields covered by the signature, in a FIXED order.
 * Must stay in lockstep with `serializeAuthContext` in `authorizer.ts`. These
 * are exactly the identity/authorization facts a service trusts; `sig` itself
 * is excluded.
 */
const SIGNED_FIELDS = [
  'userId',
  'idpSubject',
  'email',
  'roles',
  'administeredDepartmentIds',
  'grants',
] as const;

/**
 * `enforce` (default): a missing or invalid signature is rejected. `permissive`:
 * a missing signature is allowed (logged), an invalid one is still rejected —
 * used only for the one-time rollout window where cached authorizer results may
 * predate signing. See the deploy notes.
 */
export type AuthContextVerifyMode = 'enforce' | 'permissive';

/**
 * Fail closed: the runtime default is `enforce`. Only an explicit
 * `AUTH_CONTEXT_VERIFY_MODE=permissive` relaxes verification; an unset, empty,
 * or unrecognized value enforces. This way a service Lambda that is missing the
 * env var (e.g. a new function that forgot the CDK spread) rejects unsigned
 * contexts instead of silently trusting a caller-built identity (finding
 * f-b24eb0a1). Local runs and unit tests that need the relaxed behavior must
 * opt in via the env var or `VerifyAuthContextOptions.mode`.
 */
export function resolveAuthContextVerifyMode(
  env: NodeJS.ProcessEnv = process.env,
): AuthContextVerifyMode {
  return env[AUTH_CONTEXT_VERIFY_MODE_ENV] === 'permissive' ? 'permissive' : 'enforce';
}

/** True when a signing secret is configured for this function (i.e. the env var is set). */
export function isAuthContextSigningConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[AUTH_CONTEXT_SIGNING_SECRET_ENV]);
}

/** Thrown when an authorizer context is missing or carries an invalid signature. */
export class ForgedAuthContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgedAuthContextError';
  }
}

/**
 * Canonical byte string the MAC is computed over. Length-prefixing each field
 * removes any ambiguity between a value containing the delimiter and a field
 * boundary, so distinct contexts cannot collide onto the same canonical form.
 */
function canonicalize(fields: Record<string, string>): string {
  return SIGNED_FIELDS.map((name) => {
    const value = fields[name] ?? '';
    return `${name}:${value.length}:${value}`;
  }).join('|');
}

/** Compute the hex HMAC-SHA256 signature over the signed fields. */
export function computeAuthContextSignature(
  fields: Record<string, string>,
  secret: string,
): string {
  return createHmac('sha256', secret).update(canonicalize(fields), 'utf8').digest('hex');
}

/**
 * Return a copy of the serialized context with the `sig` field added. Called by
 * the authorizer on the Allow path.
 */
export function signSerializedAuthContext(
  serialized: Record<string, string>,
  secret: string,
): Record<string, string> {
  return {
    ...serialized,
    [AUTH_CONTEXT_SIG_FIELD]: computeAuthContextSignature(serialized, secret),
  };
}

/** Constant-time equality for two hex strings of arbitrary (possibly unequal) length. */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Secret loading. One shared promise per container (concurrent cold-start
// callers trigger a single fetch), mirroring db-node's salt loader. No TTL: the
// signing secret is stable for the container's lifetime.
// ---------------------------------------------------------------------------
let secretsClient: Pick<SecretsManagerClient, 'send'> | undefined;
let secretPromise: Promise<string> | undefined;

export async function loadAuthContextSigningSecret(
  client?: Pick<SecretsManagerClient, 'send'>,
): Promise<string> {
  const secretId = process.env[AUTH_CONTEXT_SIGNING_SECRET_ENV];
  if (!secretId) {
    throw new Error(`${AUTH_CONTEXT_SIGNING_SECRET_ENV} is not set`);
  }
  const sm = client ?? (secretsClient ??= new SecretsManagerClient({}));
  const response = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error('Auth context signing secret is empty or binary; expected SecretString');
  }
  return response.SecretString;
}

/**
 * Container-cached accessor for the signing secret. A rejected fetch is evicted
 * from the cache so a transient Secrets Manager failure on cold start does not
 * poison the container for its lifetime; the next call retries the fetch.
 */
export function getAuthContextSigningSecret(
  client?: Pick<SecretsManagerClient, 'send'>,
): Promise<string> {
  if (secretPromise === undefined) {
    const pending = loadAuthContextSigningSecret(client);
    pending.catch(() => {
      // Evict the rejected promise so a later invocation can retry, but only if
      // it is still the cached one (avoid clobbering a newer successful fetch).
      if (secretPromise === pending) {
        secretPromise = undefined;
      }
    });
    secretPromise = pending;
  }
  return secretPromise;
}

/** Test seam: drop the cached secret so the next call re-fetches. */
export function resetAuthContextSigningSecretCache(): void {
  secretPromise = undefined;
}

export interface VerifyAuthContextOptions {
  /** Override the mode (defaults to {@link resolveAuthContextVerifyMode}). */
  readonly mode?: AuthContextVerifyMode;
  /** Inject the secret directly (tests); otherwise it is loaded from Secrets Manager. */
  readonly secret?: string;
  /** Inject the secret loader (tests). */
  readonly loadSecret?: () => Promise<string>;
}

/**
 * Verify the signature on a raw authorizer context. Throws
 * {@link ForgedAuthContextError} when the context is forged. In `permissive`
 * mode an entirely absent signature is allowed (logged) to cover the rollout
 * window; a present-but-wrong signature is always rejected.
 */
export async function verifySerializedAuthContext(
  raw: Record<string, unknown> | null | undefined,
  options: VerifyAuthContextOptions = {},
): Promise<void> {
  const mode = options.mode ?? resolveAuthContextVerifyMode();
  const context = raw ?? {};
  const providedRaw = context[AUTH_CONTEXT_SIG_FIELD];
  const provided = typeof providedRaw === 'string' ? providedRaw : undefined;

  if (!provided) {
    if (mode === 'permissive') {
      console.warn(
        'auth context has no signature; allowing in permissive mode (rollout window only)',
      );
      return;
    }
    throw new ForgedAuthContextError('Authorization context is not signed');
  }

  const fields: Record<string, string> = {};
  for (const name of SIGNED_FIELDS) {
    const value = context[name];
    fields[name] = typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  const secret =
    options.secret ?? (await (options.loadSecret ?? getAuthContextSigningSecret)());
  const expected = computeAuthContextSignature(fields, secret);

  if (!signaturesMatch(provided, expected)) {
    throw new ForgedAuthContextError('Authorization context signature is invalid');
  }
}

/** Minimal API Gateway proxy response shape (avoids an aws-lambda import here). */
interface RejectionResponse {
  readonly statusCode: number;
  readonly body: string;
}

/**
 * Verify the authorizer context on an API Gateway proxy event. Returns a 401
 * response to return to the client when the context is forged, or `null` when
 * it is authentic (so routing may proceed). Non-forgery errors (e.g. the secret
 * cannot be loaded) propagate so the request fails closed as a 5xx rather than
 * being silently allowed.
 */
export async function rejectIfForgedAuthContext(
  event:
    | { requestContext?: { authorizer?: Record<string, unknown> | null } | null }
    | null
    | undefined,
  options: VerifyAuthContextOptions = {},
): Promise<RejectionResponse | null> {
  try {
    await verifySerializedAuthContext(event?.requestContext?.authorizer, options);
    return null;
  } catch (error) {
    if (error instanceof ForgedAuthContextError) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          code: 'UNAUTHORIZED',
          message: 'Invalid authorization context',
        }),
      };
    }
    throw error;
  }
}
