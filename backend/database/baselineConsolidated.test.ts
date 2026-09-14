import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards for content folded into the squashed baseline (formerly migrations
 * 0002–0006): Department visibility, the Ask WREN prompt column, the two
 * least-privilege grant fixes, and the Law example-department seed.
 */
const SQL = readFileSync(
  join(__dirname, 'migrations', '0001_baseline.sql'),
  'utf8',
);

describe('baseline: Department visibility (folded 0002)', () => {
  it('adds a VISIBLE-by-default constrained visibility_state on department', () => {
    expect(SQL).toMatch(
      /visibility_state text DEFAULT 'VISIBLE'::text NOT NULL/i,
    );
    expect(SQL).toMatch(
      /visibility_state = ANY \(ARRAY\['VISIBLE'::text, 'PERMITTED_ONLY'::text\]\)/i,
    );
  });

  it('creates the soft-revoked department_visibility_grant table with lifecycle FKs', () => {
    expect(SQL).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.department_visibility_grant/i,
    );
    // FKs are added in the constraints section (not inline) because the parent
    // department/app_user primary keys are added later in the baseline.
    expect(SQL).toMatch(
      /department_visibility_grant_department_id_fkey FOREIGN KEY \(department_id\) REFERENCES public\.department\(id\) ON DELETE CASCADE/i,
    );
    expect(SQL).toMatch(
      /department_visibility_grant_user_id_fkey FOREIGN KEY \(user_id\) REFERENCES public\.app_user\(id\) ON DELETE CASCADE/i,
    );
    expect(SQL).toMatch(
      /department_visibility_grant_granted_by_fkey FOREIGN KEY \(granted_by\) REFERENCES public\.app_user\(id\) ON DELETE SET NULL/i,
    );
  });

  it('indexes both lookup directions and enforces one active grant per user', () => {
    expect(SQL).toMatch(
      /uq_department_visibility_grant_active[\s\S]*\(department_id, user_id\)[\s\S]*WHERE revoked_at IS NULL/i,
    );
    expect(SQL).toMatch(/idx_department_visibility_grant_user_active/i);
    expect(SQL).toMatch(/idx_department_visibility_grant_department_active/i);
  });
});

describe('baseline: Ask WREN prompt column (folded 0003)', () => {
  it('adds a nullable ask_wren_prompt column to department', () => {
    expect(SQL).toMatch(/ask_wren_prompt text/i);
    // Must remain nullable — no NOT NULL / DEFAULT on that column.
    expect(SQL).not.toMatch(/ask_wren_prompt text[^,\n]*NOT NULL/i);
    expect(SQL).not.toMatch(/ask_wren_prompt text[^,\n]*DEFAULT/i);
  });
});

describe('baseline: least-privilege grant fixes (folded 0004 + 0005)', () => {
  it('grants wren_admin write/read on department_visibility_grant', () => {
    expect(SQL).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.department_visibility_grant\s+TO wren_admin/i,
    );
  });

  it('grants wren_authorizer UPDATE on app_user (first-login provisioning)', () => {
    expect(SQL).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.app_user TO wren_authorizer/i,
    );
  });
});

describe('baseline: Law example department seed (folded 0006)', () => {
  it('seeds the Law department with its department-level prompt', () => {
    expect(SQL).toContain('6ed1a3f1-45e6-4f5d-b1fd-b020b3193b22');
    expect(SQL).toContain('[Department Context]');
    expect(SQL).toContain('McGill Guide');
  });

  it('seeds the five Law document types and excludes the stray test category', () => {
    for (const name of [
      'Appellate Factum',
      'Case Brief',
      'Legal Memorandum',
      'Opinion Letters',
      'Pleadings',
    ]) {
      expect(SQL).toContain(`'${name}'`);
    }
    expect(SQL).not.toContain('3042c3f5-aa54-4159-a021-f0e9aa42a293');
  });

  it('seeds idempotently (ON CONFLICT DO NOTHING, no seed-time mutations)', () => {
    expect(SQL).toMatch(/ON CONFLICT \(document_type_id\) DO NOTHING/i);
    // The Law seed block must not UPDATE or DELETE existing rows.
    const seedStart = SQL.indexOf('SEED DATA: Law example department');
    expect(seedStart).toBeGreaterThan(0);
    const seedBlock = SQL.slice(seedStart);
    expect(seedBlock).not.toMatch(/\bUPDATE\b/i);
    expect(seedBlock).not.toMatch(/\bDELETE\b/i);
  });
});
