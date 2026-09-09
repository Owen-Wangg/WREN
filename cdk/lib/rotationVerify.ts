/**
 * Safe credential-rotation verification (authorizer throttling remediation,
 * Task 4b).
 *
 * The `sync-db-passwords` custom resource must confirm that each role can
 * actually authenticate THROUGH THE RDS PROXY with its new password after
 * `ALTER ROLE`, rather than assuming the change took effect. Because the proxy
 * refreshes its cached secret asynchronously (see
 * `docs/authorizer-throttling-rds-proxy-findings.md`), a freshly-altered
 * password can be briefly rejected client→proxy with Postgres 28P01. This
 * module retries ONLY that credential-mismatch case within a bounded window and
 * fails loudly otherwise, so the resource never reports a false success on a
 * desynced auth path.
 *
 * The pure retry logic lives here (in `lib/`, which the CDK tsconfig + Jest
 * project both compile) so it is unit-testable without the workspace
 * `@wren/db-node` package or a real database.
 */

/** Postgres SQLSTATE for invalid_password — the credential-mismatch signal. */
export const INVALID_PASSWORD_SQLSTATE = "28P01";

/**
 * Bounded per-role verification window (~30s: 6 attempts x 5s).
 *
 * The sync handler verifies all APP_DB_ROLES SEQUENTIALLY, so the worst-case
 * total is roughly `APP_DB_ROLES.length * VERIFY_MAX_ATTEMPTS * VERIFY_DELAY_MS`.
 * With 8 roles that is ~4 minutes; the DbPasswordSync Lambda timeout is sized
 * above that (see DbPasswordSync.ts) so a multi-role proxy-cache lag surfaces as
 * the explicit "still fails ... desynced" error, not an opaque Lambda timeout.
 */
export const VERIFY_MAX_ATTEMPTS = 6;
export const VERIFY_DELAY_MS = 5_000;

/** True only for an explicit Postgres 28P01 (invalid password). */
export function isInvalidPassword(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code === INVALID_PASSWORD_SQLSTATE;
}

/** A single authentication probe: resolves on success, rejects with the DB error. */
export type RoleProbe = (username: string, password: string) => Promise<void>;

/** Injectable timing seam so the retry loop is deterministic under test. */
export interface VerifyOptions {
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verify (via `probe`) that a role authenticates after `ALTER ROLE`. Retries
 * ONLY on 28P01 to absorb the proxy's cache-refresh window; any other error
 * fails immediately, and exhausting the window throws loudly so the custom
 * resource fails instead of reporting a false success on a desynced auth path.
 */
export async function verifyRoleWithRetry(
  username: string,
  password: string,
  probe: RoleProbe,
  options: VerifyOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? VERIFY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? VERIFY_DELAY_MS;
  const sleepFn = options.sleepFn ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await probe(username, password);
      return;
    } catch (error) {
      lastError = error;
      // Only a password mismatch is worth waiting out (proxy cache catching up).
      // Any other error (network, permission, etc.) fails immediately.
      if (!isInvalidPassword(error)) {
        throw error;
      }
      if (attempt < maxAttempts) {
        await sleepFn(delayMs);
      }
    }
  }
  throw new Error(
    `Role ${username} still fails password authentication through the proxy after ` +
      `${maxAttempts} attempts over ~${(maxAttempts * delayMs) / 1000}s. ` +
      `Refusing to report success — the auth path would be desynced. Last error: ` +
      `${String((lastError as { message?: string } | undefined)?.message ?? lastError)}`,
  );
}
