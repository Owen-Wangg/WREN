import type { Sql } from 'postgres';
import {
  DEFAULT_MIGRATIONS_DIR,
  listMigrationFiles,
  runMigrations,
} from './migrate';

describe('listMigrationFiles — lexical ordering', () => {
  it('returns the real migrations in forward-only lexical order', () => {
    const files = listMigrationFiles(DEFAULT_MIGRATIONS_DIR);
    expect(files).toEqual(['0001_enable_extensions.sql', '0002_initial_schema.sql', '0003_v4_terminology_migration.sql']);
  });

  it('orders by zero-padded numeric prefix, not insertion order', () => {
    const sorted = [...listMigrationFiles(DEFAULT_MIGRATIONS_DIR)];
    const manual = [...sorted].sort();
    expect(sorted).toEqual(manual);
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

    expect(applied).toEqual([
      '0001_enable_extensions.sql',
      '0002_initial_schema.sql',
      '0003_v4_terminology_migration.sql',
    ]);
    expect(begin).toHaveBeenCalledTimes(3);
  });

  it('skips migrations already recorded in schema_migrations', async () => {
    const { sql, begin } = mockSql(['0001_enable_extensions.sql']);

    const applied = await runMigrations(sql);

    expect(applied).toEqual(['0002_initial_schema.sql', '0003_v4_terminology_migration.sql']);
    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when the database is already current', async () => {
    const { sql, begin } = mockSql([
      '0001_enable_extensions.sql',
      '0002_initial_schema.sql',
      '0003_v4_terminology_migration.sql',
    ]);

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
    expect(insertCalls).toHaveLength(3);
    for (const [text, params] of insertCalls) {
      expect(text).toContain('VALUES ($1)');
      expect(Array.isArray(params)).toBe(true);
      expect(params).toHaveLength(1);
    }
  });
});
