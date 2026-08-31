/**
 * Programmatic, forward-only migration runner (Node).
 *
 * Applies the `.sql` files in `backend/database/migrations` in lexical filename
 * order over the TLS-enforced RDS Proxy connection. Applied migrations are
 * tracked in a `schema_migrations` table so re-running is idempotent: already
 * applied files are skipped. Each migration runs inside its own transaction and
 * its filename is recorded with a parameterized INSERT.
 *
 * Migrations are trusted, version-controlled DDL (not user input). They are the
 * one place raw SQL files are executed; all application/user-derived input flows
 * through the parameterized `DataAccess` API instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from 'postgres';

/** Migration files look like `0001_enable_extensions.sql`. */
const MIGRATION_FILE_RE = /^\d+_.*\.sql$/;

/** Default location of the shared SQL migrations relative to this module. */
export const DEFAULT_MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Return migration filenames in lexical (lexicographic) order. Numeric prefixes
 * are zero-padded, so a plain locale-independent string sort yields the correct
 * forward-only application order.
 */
export function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort();
}

interface AppliedRow {
  filename: string;
}

/**
 * Apply any not-yet-applied migrations in lexical order. Returns the list of
 * filenames applied during this run (empty if the database was already current).
 */
export async function runMigrations(
  sql: Sql,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS public.schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const appliedRows = (await sql.unsafe(
    'SELECT filename FROM public.schema_migrations',
  )) as unknown as AppliedRow[];
  const applied = new Set(appliedRows.map((row) => row.filename));

  const newlyApplied: string[] = [];
  for (const filename of listMigrationFiles(migrationsDir)) {
    if (applied.has(filename)) {
      continue;
    }
    const ddl = readFileSync(join(migrationsDir, filename), 'utf8');
    // One transaction per migration: the DDL and the bookkeeping insert either
    // both commit or both roll back.
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx.unsafe('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [
        filename,
      ]);
    });
    newlyApplied.push(filename);
  }

  return newlyApplied;
}
