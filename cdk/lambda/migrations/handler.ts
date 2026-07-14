/**
 * Database migrations Lambda — runs on stack deployment to initialize schema.
 * Applied migrations are tracked in `schema_migrations` table so re-running is idempotent.
 */
import { createSql, runMigrations } from '@wren/db-node';

export async function handler(): Promise<{ applied: string[] }> {
  const sql = createSql();
  try {
    const applied = await runMigrations(sql);
    console.log(`Applied ${applied.length} migrations:`, applied);
    return { applied };
  } finally {
    await sql.end();
  }
}
