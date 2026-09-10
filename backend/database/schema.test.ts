/**
 * Schema-invariant guard for the WREN Writing Coach relational migrations.
 *
 * A set of structural invariants the schema MUST uphold. A live PostgreSQL
 * instance is not available in unit-test CI, so this suite reads the migration
 * SQL directly and asserts the invariants hold at the DDL level. These are
 * regression guards: they fail loudly if a future edit reintroduces a forbidden
 * construct (e.g. a `replacement_prose` column) or drops a required one (e.g.
 * the Draft-immutability trigger).
 *
 * The per-feature migrations (0002–0036) that once existed were consolidated
 * into a single squashed `0001_baseline.sql` (plus the later
 * `0002_department_visibility.sql`). The baseline already reflects the V4
 * terminology — tables are named `department` / `document_type` /
 * `document_type_config` directly — so there is no separate rename migration to
 * assert; the invariants below read the consolidated baseline.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const schemaSql = readFileSync(
  join(MIGRATIONS_DIR, '0001_baseline.sql'),
  'utf8',
);

/**
 * Every core entity the baseline schema must define, in design naming →
 * snake_case table name (post-V4: `department`, `document_type`,
 * `document_type_config`).
 */
const REQUIRED_TABLES = [
  'app_user',
  'role_assignment',
  'department',
  'document_type',
  'document_type_config',
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
  'user_lifetime_usage',
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
 * CHECKs don't truncate it early). Tolerates an optional `IF NOT EXISTS` and a
 * `public.` schema qualifier.
 */
function tableBody(sql: string, table: string): string {
  const re = new RegExp(
    `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(`,
    'i',
  );
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

describe('baseline — extensions', () => {
  it('enables pgvector for reference-embedding similarity search', () => {
    expect(schemaSql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
  });

  it('enables pgcrypto for gen_random_uuid()', () => {
    expect(schemaSql).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  });
});

describe('baseline — required tables (post-V4 naming)', () => {
  it.each(REQUIRED_TABLES)('creates the %s table', (table) => {
    const re = new RegExp(
      `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(`,
      'i',
    );
    expect(schemaSql).toMatch(re);
  });

  it('uses V4 terminology directly — no organization/writing_type TABLE is defined', () => {
    // The squashed baseline defines department/document_type outright; it must
    // not re-introduce the pre-V4 `organization` / `writing_type` tables.
    expect(schemaSql).not.toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?organization\s*\(/i,
    );
    expect(schemaSql).not.toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?writing_type\s*\(/i,
    );
  });
});

describe('no-ghostwriting invariant (Requirement 11.4)', () => {
  it('declares no replacement-prose column anywhere in the baseline', () => {
    const ddl = stripComments(schemaSql).toLowerCase();
    expect(ddl).not.toContain('replacement_prose');
    expect(ddl).not.toContain('replacementprose');
  });
});

describe('immutable Drafts (Requirement 8.1)', () => {
  it('installs a BEFORE UPDATE trigger that rejects draft mutation', () => {
    expect(schemaSql).toMatch(
      /CREATE TRIGGER\s+draft_immutable\s+BEFORE UPDATE ON (?:public\.)?draft/i,
    );
  });

  it('uniquely versions Drafts per Document', () => {
    // Declared as a table-level UNIQUE constraint (inline or via ALTER TABLE
    // ADD CONSTRAINT in the squashed dump).
    expect(schemaSql).toMatch(/UNIQUE\s*\(\s*document_id\s*,\s*version_number\s*\)/i);
  });

  it('allows content/word_count-only updates for autosave', () => {
    // The immutability trigger permits an autosave carve-out: only content /
    // word_count may change on an existing draft.
    expect(schemaSql).toMatch(/reject_draft_update/i);
    expect(schemaSql).toMatch(/NEW\.segments IS DISTINCT FROM OLD\.segments/i);
  });
});

describe('category linkage by id (Requirement 15.3)', () => {
  it('links feedback_item.error_category_id to error_category(id)', () => {
    // FK may be declared inline or as a later ALTER TABLE ADD CONSTRAINT in the
    // squashed dump; assert the reference exists somewhere in the baseline.
    expect(schemaSql).toMatch(
      /error_category_id[\s\S]{0,120}REFERENCES\s+(?:public\.)?error_category\s*\(id\)/i,
    );
  });
});

describe('ActivityEvent independent of Documents (Requirement 44.2)', () => {
  it('holds no foreign key to document / draft / feedback_item', () => {
    const activityEvent = tableBody(schemaSql, 'activity_event');
    expect(activityEvent).not.toMatch(/REFERENCES\s+(?:public\.)?document\b/i);
    expect(activityEvent).not.toMatch(/REFERENCES\s+(?:public\.)?draft\b/i);
    expect(activityEvent).not.toMatch(/REFERENCES\s+(?:public\.)?feedback_item\b/i);
  });
});

describe('Departments are groupings, not tenants (Requirements 28.1 / 28.2)', () => {
  it('app_user carries no department foreign key (Users are global)', () => {
    const appUser = tableBody(schemaSql, 'app_user');
    expect(appUser).not.toMatch(/organization/i);
    expect(appUser).not.toMatch(/department/i);
  });
});

describe('deletion retention partitioning (Requirement 45.x)', () => {
  it('cascades Drafts from a deleted Document', () => {
    expect(schemaSql).toMatch(
      /draft[\s\S]{0,4000}?document_id[\s\S]{0,120}REFERENCES\s+(?:public\.)?document\s*\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  it('cascades Feedback Items from a deleted Document', () => {
    expect(schemaSql).toMatch(
      /feedback_item[\s\S]{0,4000}?document_id[\s\S]{0,120}REFERENCES\s+(?:public\.)?document\s*\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  it('restricts deleting a Document Type that still scopes Documents', () => {
    expect(schemaSql).toMatch(
      /document_type_id[\s\S]{0,120}REFERENCES\s+(?:public\.)?document_type\s*\(id\)\s+ON DELETE RESTRICT/i,
    );
  });
});
