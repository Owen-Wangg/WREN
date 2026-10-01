import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for the first-login relink hardening grants (finding f-4531f8e7).
 * The hardened ensureAppUser checks department_visibility_grant before a relink
 * and writes an append-only `identity.relinked` activity_event.
 */
const SQL = readFileSync(
  join(__dirname, 'migrations', '0007_authorizer_identity_relink_audit_grants.sql'),
  'utf8',
);

describe('0007_authorizer_identity_relink_audit_grants', () => {
  it('grants read-only access to department_visibility_grant for the privilege check', () => {
    expect(SQL).toMatch(
      /GRANT SELECT ON TABLE public\.department_visibility_grant TO wren_authorizer/i,
    );
  });

  it('grants INSERT only on activity_event for the relink audit record', () => {
    expect(SQL).toMatch(/GRANT INSERT ON TABLE public\.activity_event TO wren_authorizer/i);
  });

  it('never lets the authorizer read or mutate the activity log', () => {
    expect(SQL).not.toMatch(/GRANT[^;]*\b(SELECT|UPDATE|DELETE|TRUNCATE)\b[^;]*activity_event/i);
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
