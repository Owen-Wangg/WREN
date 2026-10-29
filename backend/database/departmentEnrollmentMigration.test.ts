import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for the Department roster import migration. The authorizer redeems
 * pending enrollments on first sign-in; it must do so through the
 * SECURITY DEFINER function only, never via direct write grants.
 */
const SQL = readFileSync(
  join(__dirname, 'migrations', '0014_department_enrollment.sql'),
  'utf8',
);

const STATEMENTS = SQL.replace(/--[^\n]*/g, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe('0014_department_enrollment', () => {
  it('keys the active roster by (department, normalized email)', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.department_enrollment/);
    expect(SQL).toMatch(/CHECK \(email = lower\(btrim\(email\)\)/);
    expect(SQL).toMatch(
      /uq_department_enrollment_active[\s\S]*\(department_id, email\)[\s\S]*WHERE revoked_at IS NULL/,
    );
  });

  it('applies grants through a SECURITY DEFINER function with a pinned search_path', () => {
    const fn = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.apply_department_enrollments[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = public, pg_temp/);
    // Never links seed placeholders or ambiguous case-variant accounts.
    expect(fn).toMatch(/idp_subject NOT LIKE 'seed:%'/);
    expect(fn).toMatch(/count\(\*\) FROM app_user u2 WHERE lower\(u2\.email\) = de\.email\) = 1/);
  });

  it('gives the authorizer EXECUTE only — no write grant on any table', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.apply_department_enrollments[^;]*FROM PUBLIC/);
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_department_enrollments\(uuid, uuid, text\[\]\)\s+TO wren_admin, wren_authorizer/,
    );
    const authorizerTableGrants = STATEMENTS.filter(
      (s) => /^GRANT\b/i.test(s) && /\bON TABLE\b/i.test(s) && /\bwren_authorizer\b/.test(s),
    );
    expect(authorizerTableGrants).toHaveLength(0);
  });

  it('grants new Document Types to linked enrollees via trigger', () => {
    expect(SQL).toMatch(
      /CREATE TRIGGER document_type_enrollment_grants\s+AFTER INSERT ON public\.document_type/,
    );
  });

  it('grants no DDL / ALL privilege', () => {
    for (const stmt of STATEMENTS) {
      expect(stmt).not.toMatch(/^GRANT\s+ALL/i);
      expect(stmt).not.toMatch(/^GRANT\s+CREATE/i);
    }
  });
});
