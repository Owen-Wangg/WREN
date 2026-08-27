import type { Sql } from 'postgres';
import {
  DEFAULT_MIGRATIONS_DIR,
  listMigrationFiles,
  runMigrations,
} from './migrate';

const CURRENT_MIGRATIONS = listMigrationFiles(DEFAULT_MIGRATIONS_DIR);
const FIRST_MIGRATION = CURRENT_MIGRATIONS[0]!;

describe('listMigrationFiles — lexical ordering', () => {
  it('returns every real migration exactly once', () => {
    expect(CURRENT_MIGRATIONS.length).toBeGreaterThan(0);
    expect(new Set(CURRENT_MIGRATIONS).size).toBe(CURRENT_MIGRATIONS.length);
    expect(CURRENT_MIGRATIONS.every((file) => /^\d+_.*\.sql$/.test(file))).toBe(true);
  });

  it('orders by zero-padded numeric prefix, not insertion order', () => {
    const manual = [...CURRENT_MIGRATIONS].sort();
    expect(CURRENT_MIGRATIONS).toEqual(manual);
  });
});

/**
 * Mock Sql for the runner: `unsafe` answers the bookkeeping queries, `begin`
 * runs the migration body against the same recorder so we can assert exactly
 * which files were applied and that the recording INSERT is parameterized.
 */
function mockSql(alreadyApplied: string[]): {
  sql: Sql;
  unsafe: jest.Mock;
  begin: jest.Mock;
} {
  const unsafe = jest.fn(async (text: string) => {
    if (/SELECT filename FROM schema_migrations/i.test(text)) {
      return alreadyApplied.map((filename) => ({ filename }));
    }
    return [];
  });
  const begin = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ unsafe }),
  );
  const sql = { unsafe, begin } as unknown as Sql;
  return { sql, unsafe, begin };
}

describe('runMigrations — idempotent forward-only application', () => {
  it('applies all migrations on a fresh database', async () => {
    const { sql, begin } = mockSql([]);

    const applied = await runMigrations(sql);

    expect(applied).toEqual(CURRENT_MIGRATIONS);
    expect(begin).toHaveBeenCalledTimes(CURRENT_MIGRATIONS.length);
  });

  it('skips migrations already recorded in schema_migrations', async () => {
    const { sql, begin } = mockSql([FIRST_MIGRATION]);

    const applied = await runMigrations(sql);

    expect(applied).toEqual(CURRENT_MIGRATIONS.slice(1));
    expect(begin).toHaveBeenCalledTimes(CURRENT_MIGRATIONS.length - 1);
  });

  it('is a no-op when the database is already current', async () => {
    const { sql, begin } = mockSql(CURRENT_MIGRATIONS);

    const applied = await runMigrations(sql);

    expect(applied).toEqual([]);
    expect(begin).not.toHaveBeenCalled();
  });

  it('records each applied migration with a parameterized INSERT', async () => {
    const { sql, unsafe } = mockSql([]);

    await runMigrations(sql);

    const insertCalls = unsafe.mock.calls.filter(([text]) =>
      /INSERT INTO schema_migrations/i.test(text as string),
    );
    expect(insertCalls).toHaveLength(CURRENT_MIGRATIONS.length);
    for (const [text, params] of insertCalls) {
      expect(text).toContain('VALUES ($1)');
      expect(Array.isArray(params)).toBe(true);
      expect(params).toHaveLength(1);
    }
  });
});
