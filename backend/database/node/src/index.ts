/**
 * `@wren/db-node` — parameterized PostgreSQL data-access layer for Node 22
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
export {
  createSql,
  getDataAccess,
  resetPool,
  freezeEventLoopOnReturn,
  type PoolEnv,
  type LambdaCallbackContext,
} from './pool';
export {
  ConnectionGuard,
  ConnectionGuardOpenError,
  classifyConnectionError,
  INVALID_PASSWORD_SQLSTATE,
  DEFAULT_OPEN_MS,
  MAX_OPEN_MS,
  type FailureClass,
  type GuardEvent,
  type GuardDeps,
} from './connectionGuard';
export {
  runMigrations,
  listMigrationFiles,
  DEFAULT_MIGRATIONS_DIR,
} from './migrate';
export {
  ACTIVITY_EVENT_COLUMNS,
  appendActivityEventRow,
  derivePseudonym,
  loadPseudonymSaltFromSecretsManager,
  pseudonymForActor,
  recordActivityEventRow,
  setPseudonymSaltLoader,
  type PseudonymSaltLoader,
  type ActivityEventRow,
  type ActivityLogQueryExecutor,
  type RecordActivityEventInput,
} from './activityLog';
