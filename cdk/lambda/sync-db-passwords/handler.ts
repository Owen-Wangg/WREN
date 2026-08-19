/**
 * Custom resource: set Postgres LOGIN passwords from Secrets Manager.
 *
 * Runs as dbadmin after migrations (roles exist, no password in SQL).
 * Uses format(%I, %L) so identifiers/passwords are quoted safely.
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  buildConnectionOptions,
  resolveDatabaseCredentials,
  createSql,
} from "@wren/db-node";

import { APP_DB_ROLES } from "../../lib/appDbRoles";

const ALLOWED_ROLES = new Set<string>(APP_DB_ROLES);

interface SyncEvent {
  readonly RequestType?: string;
}

export async function handler(
  event: SyncEvent,
): Promise<{ PhysicalResourceId: string; synced?: string }> {
  const physicalId = "WrenDbPasswordSync";
  if (event.RequestType === "Delete") {
    return { PhysicalResourceId: physicalId };
  }

  const adminSecretId = process.env.DB_SECRET_ARN;
  if (!adminSecretId) {
    throw new Error("DB_SECRET_ARN environment variable is required.");
  }

  const appSecretArns = (process.env.APP_DB_SECRET_ARNS ?? "")
    .split(",")
    .map((arn) => arn.trim())
    .filter((arn) => arn.length > 0);
  if (appSecretArns.length === 0) {
    throw new Error("APP_DB_SECRET_ARNS must be a comma-separated list of secret ARNs.");
  }

  const credentials = await resolveDatabaseCredentials(adminSecretId, {
    overrides: {
      host: process.env.DB_PROXY_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      dbname: process.env.DB_NAME,
    },
  });

  const secretsClient = new SecretsManagerClient({});
  const sql = createSql(buildConnectionOptions(credentials));
  const synced: string[] = [];

  try {
    for (const secretArn of appSecretArns) {
      const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretArn }),
      );
      if (!response.SecretString) {
        throw new Error(`Secret ${secretArn} has no SecretString.`);
      }
      let parsed: { username?: string; password?: string };
      try {
        parsed = JSON.parse(response.SecretString) as {
          username?: string;
          password?: string;
        };
      } catch {
        throw new Error(`Secret ${secretArn} is not valid JSON.`);
      }
      const username = parsed.username?.trim();
      const password = parsed.password;
      if (!username || !password) {
        throw new Error(`Secret ${secretArn} is missing username or password.`);
      }
      if (!ALLOWED_ROLES.has(username)) {
        throw new Error(`Refusing to ALTER ROLE for unexpected username ${JSON.stringify(username)}.`);
      }

      // Tagged-template binds are untyped; format() is VARIADIC "any", so
      // Postgres cannot infer $1/$2 unless the cast is in the SQL string.
      const [row] = await sql.unsafe(
        "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS ddl",
        [username, password],
      );
      const ddl = (row as { ddl?: string } | undefined)?.ddl;
      if (!ddl) {
        throw new Error(`Failed to format ALTER ROLE for ${username}.`);
      }
      await sql.unsafe(ddl);
      synced.push(username);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(`Synced passwords for ${synced.length} roles:`, synced);
  return { PhysicalResourceId: physicalId, synced: synced.join(",") };
}
