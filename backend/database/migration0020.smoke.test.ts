/**
 * Smoke tests for migration `0020_footnote_citation_config.sql`
 * (footnote-citation-support spec, Task 1.2).
 *
 * Follows the static-SQL-parsing convention established in `schema.test.ts`
 * (no live PostgreSQL instance in unit-test CI) to guard the additive-only
 * safety invariants required by Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const footnoteMigrationSql = readFileSync(
  join(MIGRATIONS_DIR, '0020_footnote_citation_config.sql'),
  'utf8',
);

/** Strip `--` line comments so structural checks inspect DDL, not documentation. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*/, ''))
    .join('\n');
}

describe('migration 0020 — footnote citation config (additive-only DDL)', () => {
  const ddl = stripComments(footnoteMigrationSql);

  it('contains exactly one ALTER TABLE ... ADD COLUMN IF NOT EXISTS statement', () => {
    const matches = ddl.match(/ALTER TABLE\s+document_type_config\s+ADD COLUMN IF NOT EXISTS\s+citation_config\s+jsonb/gi);
    expect(matches).not.toBeNull();
    expect(matches).toHaveLength(1);
  });

  it('contains exactly one statement overall (single ALTER TABLE, semicolon-terminated)', () => {
    const statements = ddl
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(statements).toHaveLength(1);
  });

  it('does not DROP, RENAME, or ALTER ... TYPE any column (Requirement 6.1)', () => {
    expect(ddl).not.toMatch(/DROP COLUMN/i);
    expect(ddl).not.toMatch(/RENAME/i);
    expect(ddl).not.toMatch(/ALTER COLUMN\s+\w+\s+TYPE/i);
  });

  it('does not add a NOT NULL constraint (Requirement 6.3)', () => {
    expect(ddl).not.toMatch(/NOT NULL/i);
  });

  it('does not add a DEFAULT expression (Requirement 6.3)', () => {
    expect(ddl).not.toMatch(/DEFAULT/i);
  });

  it('does not add a CHECK constraint (Requirement 6.3)', () => {
    expect(ddl).not.toMatch(/CHECK\s*\(/i);
  });

  it('performs no UPDATE, DELETE, or INSERT on existing rows (Requirement 6.6)', () => {
    expect(ddl).not.toMatch(/\bUPDATE\b/i);
    expect(ddl).not.toMatch(/\bDELETE\b/i);
    expect(ddl).not.toMatch(/\bINSERT\b/i);
  });

  it('uses IF NOT EXISTS, making re-execution a no-op (Requirement 6.4)', () => {
    expect(ddl).toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it('only touches document_type_config — no other table is referenced', () => {
    const alterTableMatches = ddl.match(/ALTER TABLE\s+(\w+)/gi) ?? [];
    for (const stmt of alterTableMatches) {
      expect(stmt).toMatch(/document_type_config/i);
    }
  });

  it('adds citation_config as a plain jsonb column', () => {
    expect(ddl).toMatch(/citation_config\s+jsonb\s*;/i);
  });
});
