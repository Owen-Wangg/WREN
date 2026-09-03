/**
 * Smoke test for the footnote-citation-config column (footnote-citation-support
 * spec, Requirements 6.1–6.6).
 *
 * The additive migration that introduced `document_type_config.citation_config`
 * (formerly `0020_footnote_citation_config.sql`) was consolidated into
 * `0001_baseline.sql`, where the column now appears directly in the
 * `document_type_config` table definition. The safety invariant the original
 * migration guaranteed still holds: `citation_config` is a plain, nullable
 * `jsonb` column with no NOT NULL / DEFAULT / CHECK constraint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const schemaSql = readFileSync(
  join(MIGRATIONS_DIR, '0001_baseline.sql'),
  'utf8',
);

/** Strip `--` line comments so structural checks inspect DDL, not documentation. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*/, ''))
    .join('\n');
}

/** Body of the `document_type_config` CREATE TABLE statement. */
function documentTypeConfigBody(sql: string): string {
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?document_type_config\s*\(/i;
  const match = re.exec(sql);
  if (!match) throw new Error('CREATE TABLE document_type_config not found');
  let depth = 0;
  const start = match.index + match[0].length - 1;
  for (let i = start; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(start + 1, i);
    }
  }
  throw new Error('Unbalanced parentheses for document_type_config');
}

describe('citation_config column (footnote citation config)', () => {
  const body = stripComments(documentTypeConfigBody(schemaSql));

  it('declares citation_config as a plain jsonb column on document_type_config', () => {
    expect(body).toMatch(/citation_config\s+jsonb/i);
  });

  it('does not constrain citation_config NOT NULL (Requirement 6.3)', () => {
    expect(body).not.toMatch(/citation_config\s+jsonb[^,)]*NOT NULL/i);
  });

  it('does not give citation_config a DEFAULT expression (Requirement 6.3)', () => {
    expect(body).not.toMatch(/citation_config\s+jsonb[^,)]*DEFAULT/i);
  });

  it('does not attach a CHECK constraint to citation_config (Requirement 6.3)', () => {
    expect(body).not.toMatch(/CHECK\s*\([^)]*citation_config/i);
  });
});
