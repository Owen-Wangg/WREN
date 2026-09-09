/**
 * Custom resource: set Postgres LOGIN passwords from Secrets Manager.
 *
 * Runs as dbadmin after migrations (roles exist, no password in SQL).
 * Uses format(%I, %L) so identifiers/passwords are quoted safely.
 *
 * SAFE ROTATION (authorizer throttling remediation, Task 4b):
 * After each ALTER ROLE, the handler VERIFIES — through the RDS Proxy, as the
 * role, with the new password — that the credential actually authenticates,
 * retrying only while the proxy's secret cache catches up (28P01) and failing
 * loudly on a persistent mismatch. This prevents the sync from reporting
 * success while the auth critical path is silently desynced. The bounded retry
 * logic lives in ../../lib/rotationVerify.ts so it is unit-testable.
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  buildConnectionOptions,
  resolveDatabaseCredentials,
  createSql,
} from "@wren/db-node";

import { APP_DB_ROLES } from "../../lib/appDbRoles";
import { type RoleProbe, verifyRoleWithRetry } from "../../lib/rotationVerify";

const ALLOWED_ROLES = new Set<string>(APP_DB_ROLES);

interface SyncEvent {
  readonly RequestType?: string;
}

/**
 * Build a probe that opens a fresh proxy connection AS the role with the given
 * password and runs `SELECT 1`. Used to confirm the ALTER ROLE took effect
 * client→proxy before the role is counted as synced.
 */
function proxyProbe(overrides: { host?: string; port?: number; dbname?: string }): RoleProbe {
  if (!overrides.host) {
    throw new Error("DB_PROXY_HOST is required to verify a role through the proxy.");
  }
  return async (username: string, password: string): Promise<void> => {
    const sql = createSql(
      buildConnectionOptions({
        host: overrides.host as string,
        port: overrides.port ?? 5432,
        username,
        password,
        dbname: overrides.dbname ?? "appdb",
      }),
    );
    try {
      await sql.unsafe("SELECT 1");
    } finally {
      // Never let a teardown rejection escape after the probe resolves/rejects.
      void sql.end({ timeout: 1 }).catch(() => {
        /* ignore close errors on probe teardown */
      });
    }
  };
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

  // Non-secret connection overrides shared by the admin ALTER and the per-role
  // verification connects (both go through the RDS Proxy endpoint).
  const connectionOverrides = {
    host: process.env.DB_PROXY_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    dbname: process.env.DB_NAME,
  };

  const credentials = await resolveDatabaseCredentials(adminSecretId, {
    overrides: connectionOverrides,
  });

  const secretsClient = new SecretsManagerClient({});
  const sql = createSql(buildConnectionOptions(credentials));
  const verifyProbe = proxyProbe(connectionOverrides);
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

      // Verify the new password actually authenticates THROUGH THE PROXY before
      // counting this role as synced. Fails loudly on a persistent mismatch so
      // we never silently leave the auth critical path desynced.
      await verifyRoleWithRetry(username, password, verifyProbe);

      synced.push(username);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(`Synced + verified passwords for ${synced.length} roles:`, synced);
  return { PhysicalResourceId: physicalId, synced: synced.join(",") };
}
