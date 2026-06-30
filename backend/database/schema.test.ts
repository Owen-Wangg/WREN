/**
 * Schema-invariant guard for the WREN Writing Coach relational migrations.
 *
 * Task 2.3 calls out a set of structural invariants the schema MUST uphold. A
 * live PostgreSQL instance is not available in unit-test CI, so this suite reads
 * the migration SQL directly and asserts the invariants hold at the DDL level.
 * These are regression guards: they fail loudly if a future edit reintroduces a
 * forbidden construct (e.g. a `replacement_prose` column) or drops a required
 * one (e.g. the Draft-immutability trigger).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const extensionsSql = readFileSync(
  join(MIGRATIONS_DIR, '0001_enable_extensions.sql'),
  'utf8',
);
const schemaSql = readFileSync(
  join(MIGRATIONS_DIR, '0002_initial_schema.sql'),
  'utf8',
);

/** All 22 entities task 2.3 requires, in design naming → snake_case table name. */
const REQUIRED_TABLES = [
  'app_user',
  'role_assignment',
  'organization',
  'writing_type',
  'writing_type_config',
  'error_category',
  'content_type',
  'custom_metadata_field',
  'topic',
  'access_grant',
  'document',
  'draft',
  'anchor',
  'feedback_item',
  'resolution_status_history',
  'reference_material',
  'usage_limit',
  'usage_counter',
  'override',
  'activity_event',
  'aggregate_counter',
] as const;

/** Strip `--` line comments so invariant checks inspect DDL, not documentation. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*/, ''))
    .join('\n');
}

/**
 * Extract the body of a `CREATE TABLE <name> ( ... );` statement so individual
 * tables can be inspected in isolation. Returns the text between the opening
 * paren and its matching close (paren-balanced, so JSONB defaults and nested
 * CHECKs don't truncate it early).
 */
function tableBody(sql: string, table: string): string {
  const re = new RegExp(`CREATE TABLE\\s+${table}\\s*\\(`, 'i');
  const match = re.exec(sql);
  if (!match) {
    throw new Error(`CREATE TABLE ${table} not found`);
  }
  let depth = 0;
  const start = match.index + match[0].length - 1; // position of the '('
  for (let i = start; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return sql.slice(start + 1, i);
      }
    }
  }
  throw new Error(`Unbalanced parentheses for CREATE TABLE ${table}`);
}

describe('migration 0001 — extensions', () => {
  it('enables pgvector for reference-embedding similarity search', () => {
    expect(extensionsSql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
  });

  it('enables pgcrypto for gen_random_uuid()', () => {
    expect(extensionsSql).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  });
});

describe('migration 0002 — required tables', () => {
  it.each(REQUIRED_TABLES)('creates the %s table', (table) => {
    const re = new RegExp(`CREATE TABLE\\s+${table}\\s*\\(`, 'i');
    expect(schemaSql).toMatch(re);
  });

  it('wraps the schema in a single transaction', () => {
    expect(schemaSql).toMatch(/^BEGIN;/m);
    expect(schemaSql).toMatch(/COMMIT;\s*$/);
  });
});

describe('no-ghostwriting invariant (Requirement 11.4)', () => {
  it('declares no replacement-prose column anywhere', () => {
    const ddl = stripComments(schemaSql).toLowerCase();
    expect(ddl).not.toContain('replacement_prose');
    expect(ddl).not.toContain('replacementprose');
  });
});

describe('immutable Drafts (Requirement 8.1)', () => {
  it('installs a BEFORE UPDATE trigger that rejects draft mutation', () => {
    expect(schemaSql).toMatch(
      /CREATE TRIGGER\s+draft_immutable\s+BEFORE UPDATE ON draft/i,
    );
    expect(schemaSql).toMatch(/Draft rows are immutable/i);
  });

  it('uniquely versions Drafts per Document', () => {
    const draft = tableBody(schemaSql, 'draft');
    expect(draft).toMatch(/UNIQUE\s*\(\s*document_id\s*,\s*version_number\s*\)/i);
  });
});

describe('category linkage by id (Requirement 15.3)', () => {
  it('links feedback_item.error_category_id to error_category(id)', () => {
    const feedbackItem = tableBody(schemaSql, 'feedback_item');
    expect(feedbackItem).toMatch(
      /error_category_id\s+uuid\s+NOT NULL\s+REFERENCES\s+error_category\(id\)/i,
    );
  });
});

describe('ActivityEvent independent of Documents (Requirement 44.2)', () => {
  it('holds no foreign key to document / draft / feedback_item', () => {
    const activityEvent = tableBody(schemaSql, 'activity_event');
    expect(activityEvent).not.toMatch(/REFERENCES\s+document/i);
    expect(activityEvent).not.toMatch(/REFERENCES\s+draft/i);
    expect(activityEvent).not.toMatch(/REFERENCES\s+feedback_item/i);
  });
});

describe('Organizations are groupings, not tenants (Requirements 28.1 / 28.2)', () => {
  it('app_user carries no organization foreign key (Users are global)', () => {
    const appUser = tableBody(schemaSql, 'app_user');
    expect(appUser).not.toMatch(/organization/i);
  });
});

describe('deletion retention partitioning (Requirement 45.x)', () => {
  it('cascades Drafts from a deleted Document', () => {
    const draft = tableBody(schemaSql, 'draft');
    expect(draft).toMatch(
      /document_id\s+uuid\s+NOT NULL\s+REFERENCES\s+document\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  it('cascades Feedback Items from a deleted Document', () => {
    const feedbackItem = tableBody(schemaSql, 'feedback_item');
    expect(feedbackItem).toMatch(
      /document_id\s+uuid\s+NOT NULL\s+REFERENCES\s+document\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  it('restricts deleting a Writing Type that still scopes Documents', () => {
    const document = tableBody(schemaSql, 'document');
    expect(document).toMatch(
      /writing_type_id\s+uuid\s+NOT NULL\s+REFERENCES\s+writing_type\(id\)\s+ON DELETE RESTRICT/i,
    );
  });
});
