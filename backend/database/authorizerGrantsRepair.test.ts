import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for the authorizer role-GRANT repair migration (authorizer throttling
 * remediation, Task 5). The Sep 3 incident was Postgres 42501 (permission
 * denied for table app_user) on wren_authorizer. This forward-only migration
 * re-applies exactly the privileges the authorizer needs, idempotently, so an
 * environment created before the grants were folded into the baseline recovers.
 */
const SQL = readFileSync(
  join(__dirname, 'migrations', '0002_authorizer_grants_repair.sql'),
  'utf8',
);

describe('0002_authorizer_grants_repair', () => {
  it('re-applies the exact app_user privileges the authorizer requires', () => {
    // SELECT + INSERT + UPDATE — UPDATE is mandatory to plan ON CONFLICT DO UPDATE.
    expect(SQL).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.app_user TO wren_authorizer/i,
    );
  });

  it('re-applies role_assignment SELECT + INSERT (Student bootstrap)', () => {
    expect(SQL).toMatch(
      /GRANT SELECT, INSERT ON TABLE public\.role_assignment TO wren_authorizer/i,
    );
  });

  it('re-applies access_grant SELECT (active-grant lookup)', () => {
    expect(SQL).toMatch(
      /GRANT SELECT ON TABLE public\.access_grant TO wren_authorizer/i,
    );
  });

  it('re-asserts connect + schema usage in case a pre-squash env missed them', () => {
    expect(SQL).toMatch(/GRANT CONNECT ON DATABASE appdb TO wren_authorizer/i);
    expect(SQL).toMatch(/GRANT USAGE ON SCHEMA public TO wren_authorizer/i);
  });

  it('guards on role existence so it fails loudly if the baseline never ran', () => {
    expect(SQL).toMatch(/pg_roles WHERE rolname = 'wren_authorizer'/i);
    expect(SQL).toMatch(/RAISE EXCEPTION/i);
  });

  it('grants no DDL / CREATE privilege (stays least-privilege)', () => {
    expect(SQL).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA/i);
    expect(SQL).not.toMatch(/GRANT\s+ALL/i);
  });
});
