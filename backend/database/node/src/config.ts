/**
 * Connection configuration for the Node data-access layer.
 *
 * Security invariants (Requirement 39.2 / UBC CIC security + DB steering):
 *   - TLS to the database is MANDATORY. RDS Proxy is provisioned with
 *     `rds.force_ssl` (task 2.1), so every connection must negotiate TLS.
 *     `ssl` is typed as the literal `'require'` and there is deliberately no
 *     code path that disables it.
 *   - Credentials are never hardcoded; they arrive as `DatabaseCredentials`
 *     resolved from Secrets Manager at runtime (see `secrets.ts`).
 *   - Connection pooling is on by default (`max`) so warm Lambda invocations
 *     reuse connections through RDS Proxy.
 */

/** Database credentials resolved from Secrets Manager (never hardcoded). */
export interface DatabaseCredentials {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly dbname: string;
}

/** Optional pool/timeout tuning. Sensible Lambda-friendly defaults applied. */
export interface PoolTuning {
  /** Max pooled connections per execution environment. Default 5. */
  readonly max?: number;
  /** Seconds an idle connection is kept before closing. Default 30. */
  readonly idleTimeoutSeconds?: number;
  /** Seconds to wait when establishing a connection. Default 10. */
  readonly connectTimeoutSeconds?: number;
}

/**
 * The exact options object handed to the `postgres` driver. `ssl` is pinned to
 * the literal `'require'` so TLS can never be turned off through this layer.
 */
export interface PgConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl: 'require';
  readonly max: number;
  readonly idle_timeout: number;
  readonly connect_timeout: number;
  /** Use server-side prepared statements (parameterized, plan-cached). */
  readonly prepare: boolean;
}

const DEFAULT_MAX_CONNECTIONS = 5;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;

/**
 * Build `postgres` driver options from resolved credentials. TLS is always
 * enforced; callers cannot opt out.
 */
export function buildConnectionOptions(
  credentials: DatabaseCredentials,
  tuning: PoolTuning = {},
): PgConnectionOptions {
  if (!credentials.host) {
    throw new Error('Database host is required to build connection options.');
  }
  if (!Number.isInteger(credentials.port) || credentials.port <= 0) {
    throw new Error(`Invalid database port: ${String(credentials.port)}`);
  }

  return {
    host: credentials.host,
    port: credentials.port,
    user: credentials.username,
    password: credentials.password,
    database: credentials.dbname,
    // TLS is mandatory — connecting to RDS Proxy without it is rejected by
    // `rds.force_ssl`. This is intentionally a constant.
    ssl: 'require',
    max: tuning.max ?? DEFAULT_MAX_CONNECTIONS,
    idle_timeout: tuning.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
    connect_timeout: tuning.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS,
    prepare: true,
  };
}
