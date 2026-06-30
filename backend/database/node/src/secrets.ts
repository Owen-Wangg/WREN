/**
 * Runtime resolution of database credentials from AWS Secrets Manager.
 *
 * Credentials are NEVER hardcoded or read from plaintext env vars. The Lambda
 * receives only the secret id/arn (`DB_SECRET_ARN`) and, optionally, the RDS
 * Proxy endpoint details as non-secret config. The actual username/password
 * are fetched from Secrets Manager at runtime (UBC CIC security steering).
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { DatabaseCredentials } from './config';

/**
 * Non-secret connection overrides. RDS-managed secrets sometimes carry only the
 * username/password (and the engine host), while the application connects
 * through the RDS Proxy endpoint supplied as non-secret config. These let the
 * caller supply the proxy host/port/dbname without putting them in the secret.
 */
export interface CredentialOverrides {
  readonly host?: string;
  readonly port?: number;
  readonly dbname?: string;
}

export interface ResolveOptions {
  /** Injectable client (defaults to a real client; overridden in tests). */
  readonly client?: SecretsManagerClient;
  readonly overrides?: CredentialOverrides;
}

/** Shape of an RDS-style secret payload (only the fields we consume). */
interface RawSecret {
  host?: string;
  port?: number | string;
  username?: string;
  password?: string;
  dbname?: string;
  database?: string;
}

/**
 * Fetch and parse database credentials from Secrets Manager. Non-secret
 * overrides (proxy host/port/dbname) take precedence over values in the secret.
 */
export async function resolveDatabaseCredentials(
  secretId: string,
  options: ResolveOptions = {},
): Promise<DatabaseCredentials> {
  if (!secretId) {
    throw new Error('A Secrets Manager secret id/arn is required.');
  }

  const client = options.client ?? new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );

  if (!response.SecretString) {
    throw new Error('Secret value is empty or binary; expected SecretString.');
  }

  let raw: RawSecret;
  try {
    raw = JSON.parse(response.SecretString) as RawSecret;
  } catch {
    throw new Error('Secret is not valid JSON.');
  }

  const overrides = options.overrides ?? {};
  const host = overrides.host ?? raw.host;
  const portValue = overrides.port ?? raw.port;
  const dbname = overrides.dbname ?? raw.dbname ?? raw.database;

  if (!raw.username || !raw.password) {
    throw new Error('Secret is missing required username/password fields.');
  }
  if (!host) {
    throw new Error('Database host is not present in the secret or overrides.');
  }
  if (!dbname) {
    throw new Error('Database name is not present in the secret or overrides.');
  }

  const port = typeof portValue === 'string' ? Number(portValue) : portValue;
  if (port === undefined || !Number.isFinite(port)) {
    throw new Error('Database port is not present in the secret or overrides.');
  }

  return {
    host,
    port,
    username: raw.username,
    password: raw.password,
    dbname,
  };
}
