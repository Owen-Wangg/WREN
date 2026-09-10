/**
 * Pooled `postgres` connection factory with a per-execution-environment cache
 * so warm Lambda invocations reuse connections through RDS Proxy.
 */
import postgres, { type Sql } from 'postgres';
import { buildConnectionOptions, type PgConnectionOptions, type PoolTuning } from './config';
import { DataAccess } from './client';
import { resolveDatabaseCredentials } from './secrets';
import { ConnectionGuard, ConnectionGuardOpenError } from './connectionGuard';

/** Create a pooled `postgres` client from fully-resolved options. */
export function createSql(options: PgConnectionOptions): Sql {
  return postgres(options);
}

let cachedSql: Sql | undefined;

/**
 * Process-local bounded failure guard (authorizer throttling remediation).
 * Only credential-class failures (Postgres 28P01) trip it, and only for a very
 * short window, so a desynced password fails fast instead of hammering Secrets
 * Manager + Postgres on every invocation — while a transient blip still retries
 * immediately. See `connectionGuard.ts`.
 */
const connectionGuard = new ConnectionGuard();

/**
 * Minimal Lambda `context` shape. `@wren/db-node` does not depend on `aws-lambda`.
 */
export interface LambdaCallbackContext {
  callbackWaitsForEmptyEventLoop: boolean;
}

/**
 * Freeze the execution environment as soon as the handler returns.
 *
 * `postgres` keeps pooled sockets open (`idle_timeout` defaults to 30s).
 * Lambda's default `callbackWaitsForEmptyEventLoop = true` then waits for
 * those sockets to close, hits the function timeout, and the runtime has
 * already accepted the handler result — posting it fails with HTTP 403 and
 * `InvalidStateTransition` (`RuntimeResponseSentState` → `InvocationErrorResponse`).
 *
 * Call this at the top of every Lambda that uses {@link getDataAccess}.
 */
export function freezeEventLoopOnReturn(context: LambdaCallbackContext | undefined): void {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
}

/**
 * Required environment variables:
 *   - DB_SECRET_ARN  : Secrets Manager id/arn holding the DB credentials.
 * Optional (non-secret) overrides for the RDS Proxy endpoint:
 *   - DB_PROXY_HOST, DB_PORT, DB_NAME
 */
export interface PoolEnv {
  DB_SECRET_ARN?: string;
  DB_PROXY_HOST?: string;
  DB_PORT?: string;
  DB_NAME?: string;
}

/**
 * Resolve credentials from Secrets Manager and return a cached, pooled
 * `DataAccess`. The first call performs the secret lookup; later calls in the
 * same execution environment reuse the existing pool.
 */
export async function getDataAccess(
  env: PoolEnv = process.env as PoolEnv,
  tuning: PoolTuning = {},
): Promise<DataAccess> {
  if (cachedSql) {
    return new DataAccess(cachedSql);
  }

  // Fail fast while the guard is open (a recent credential-class failure). This
  // avoids re-paying the Secrets Manager fetch + TLS connect + failed handshake
  // on every invocation during a password-desync window. The window is tiny and
  // becomes probeable immediately once it elapses, so recovery is near-instant.
  if (connectionGuard.isOpen()) {
    throw new ConnectionGuardOpenError();
  }

  const secretId = env.DB_SECRET_ARN;
  if (!secretId) {
    throw new Error('DB_SECRET_ARN environment variable is required.');
  }

  const credentials = await resolveDatabaseCredentials(secretId, {
    overrides: {
      host: env.DB_PROXY_HOST,
      port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
      dbname: env.DB_NAME,
    },
  });

  const sql = createSql(buildConnectionOptions(credentials, tuning));
  try {
    // Fail here — not on a later query — so a bad password is not cached
    // and postgres.js cannot reject an idle socket after the handler returns.
    await sql.unsafe('SELECT 1');
  } catch (error) {
    // Tear down the half-open pool WITHOUT letting its rejection escape after
    // the handler returns (an unhandled postgres.js socket rejection can crash
    // the runtime -> forced cold start -> concurrency amplification).
    void sql.end({ timeout: 1 }).catch(() => {
      // ignore close errors on a failed handshake
    });
    cachedSql = undefined;
    // Only a credential-class failure (28P01) opens the guard; a transient
    // failure leaves it closed so the next invocation retries immediately.
    connectionGuard.recordFailure(error);
    throw error;
  }
  // Success: cache the pool and close the guard immediately (instant recovery).
  cachedSql = sql;
  connectionGuard.recordSuccess();
  return new DataAccess(cachedSql);
}

/** Reset the cached pool (closes connections). Primarily for tests/shutdown. */
export async function resetPool(): Promise<void> {
  connectionGuard.reset();
  if (cachedSql) {
    await cachedSql.end({ timeout: 5 });
    cachedSql = undefined;
  }
}
