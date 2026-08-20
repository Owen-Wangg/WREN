/**
 * Pooled `postgres` connection factory with a per-execution-environment cache
 * so warm Lambda invocations reuse connections through RDS Proxy.
 */
import postgres, { type Sql } from 'postgres';
import { buildConnectionOptions, type PgConnectionOptions, type PoolTuning } from './config';
import { DataAccess } from './client';
import { resolveDatabaseCredentials } from './secrets';

/** Create a pooled `postgres` client from fully-resolved options. */
export function createSql(options: PgConnectionOptions): Sql {
  return postgres(options);
}

let cachedSql: Sql | undefined;

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

  cachedSql = createSql(buildConnectionOptions(credentials, tuning));
  return new DataAccess(cachedSql);
}

/** Reset the cached pool (closes connections). Primarily for tests/shutdown. */
export async function resetPool(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end({ timeout: 5 });
    cachedSql = undefined;
  }
}
