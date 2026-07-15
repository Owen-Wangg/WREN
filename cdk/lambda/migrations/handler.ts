/**
 * Database migrations Lambda — runs on stack deployment to initialize schema.
 * Applied migrations are tracked in `schema_migrations` table so re-running is idempotent.
 */
import { buildConnectionOptions, resolveDatabaseCredentials, createSql, runMigrations } from '@wren/db-node';

export async function handler(): Promise<{ applied: string[] }> {
  const secretId = process.env.DB_SECRET_ARN;
  if (!secretId) {
    throw new Error('DB_SECRET_ARN environment variable is required.');
  }

  const credentials = await resolveDatabaseCredentials(secretId, {
    overrides: {
      host: process.env.DB_PROXY_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      dbname: process.env.DB_NAME,
    },
  });

  const migrationsDir = process.env.MIGRATIONS_DIR ?? '/var/task/migrations';
  const sql = createSql(buildConnectionOptions(credentials));
  try {
    const applied = await runMigrations(sql, migrationsDir);
    console.log(`Applied ${applied.length} migrations:`, applied);
    return { applied };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
