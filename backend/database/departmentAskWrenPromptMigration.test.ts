import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(__dirname, 'migrations', '0003_department_ask_wren_prompt.sql'),
  'utf8',
);

describe('department Ask WREN prompt migration', () => {
  it('wraps the migration in a single transaction', () => {
    expect(migrationSql).toMatch(/^BEGIN;/m);
    expect(migrationSql).toMatch(/COMMIT;\s*$/);
  });

  it('adds a nullable ask_wren_prompt column to department (idempotently)', () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE public\.department\s+ADD COLUMN IF NOT EXISTS ask_wren_prompt text/i,
    );
  });

  it('does not constrain the column NOT NULL (NULL means no department layer)', () => {
    // A NOT NULL / DEFAULT clause on ask_wren_prompt would change existing-row
    // behavior; the column must remain nullable with no backfill.
    expect(migrationSql).not.toMatch(/ask_wren_prompt text[^;]*NOT NULL/i);
    expect(migrationSql).not.toMatch(/ask_wren_prompt text[^;]*DEFAULT/i);
  });

  it('leaves the pre-existing department.prompt column untouched', () => {
    // Ignore SQL comments; only inspect executable DDL.
    const ddl = migrationSql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(ddl).not.toMatch(/DROP COLUMN/i);
    // The only column touched is ask_wren_prompt — never the existing `prompt`.
    expect(ddl).not.toMatch(/ADD COLUMN IF NOT EXISTS prompt\b/i);
    expect(ddl).not.toMatch(/ALTER COLUMN\s+prompt\b/i);
  });
});
