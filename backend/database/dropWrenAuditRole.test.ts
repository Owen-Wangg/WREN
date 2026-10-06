import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for retiring the orphaned wren_audit login (finding f-71876844).
 */
const SQL = readFileSync(
  join(__dirname, 'migrations', '0008_drop_wren_audit_role.sql'),
  'utf8',
);

/** Executable SQL only (line comments stripped). */
const CODE = SQL.replace(/--[^\n]*/g, '');

describe('0008_drop_wren_audit_role', () => {
  it('is a no-op when the role is already gone', () => {
    expect(CODE).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'wren_audit'\)/);
    expect(CODE).toMatch(/RETURN;/);
  });

  it('refuses to drop the role if it owns objects', () => {
    expect(CODE).toMatch(/relowner/);
    expect(CODE).toMatch(/proowner/);
    expect(CODE).toMatch(/nspowner/);
    expect(CODE).toMatch(/RAISE EXCEPTION/);
    // The ownership guard must run before anything destructive.
    expect(CODE.indexOf('RAISE EXCEPTION')).toBeLessThan(CODE.indexOf('DROP OWNED BY'));
  });

  it('disables login, revokes privileges, then drops the role', () => {
    const order = [
      'ALTER ROLE wren_audit NOLOGIN',
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM wren_audit',
      'REVOKE ALL PRIVILEGES ON DATABASE appdb FROM wren_audit',
      'DROP OWNED BY wren_audit',
      'DROP ROLE wren_audit',
    ].map((stmt) => CODE.indexOf(stmt));
    for (const idx of order) expect(idx).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('touches no other application role', () => {
    expect(CODE).not.toMatch(
      /wren_(authorizer|appsync_auth|document|admin|feedback_orch|feedback_engine|notification)\b/,
    );
  });
});
