/**
 * `@leon/db-node` — parameterized PostgreSQL data-access layer for Node 22
 * Lambdas. Connects to RDS PostgreSQL 16 through RDS Proxy with TLS enforced,
 * resolves credentials from Secrets Manager at runtime, pools connections, and
 * runs forward-only migrations.
 */
export {
  buildConnectionOptions,
  type DatabaseCredentials,
  type PgConnectionOptions,
  type PoolTuning,
} from './config';
export {
  resolveDatabaseCredentials,
  type CredentialOverrides,
  type ResolveOptions,
} from './secrets';
export { DataAccess } from './client';
export { createSql, getDataAccess, resetPool, type PoolEnv } from './pool';
export {
  runMigrations,
  listMigrationFiles,
  DEFAULT_MIGRATIONS_DIR,
} from './migrate';
