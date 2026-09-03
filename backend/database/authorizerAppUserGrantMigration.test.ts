import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(__dirname, 'migrations', '0005_authorizer_app_user_update_privilege.sql'),
  'utf8',
);

describe('authorizer app_user UPDATE privilege migration', () => {
  it('grants wren_authorizer UPDATE on app_user for first-login provisioning', () => {
    // ensureAppUser runs `INSERT ... ON CONFLICT DO UPDATE` and an email-relink
    // UPDATE. Postgres requires UPDATE privilege to plan the ON CONFLICT DO
    // UPDATE even when no conflict fires, so without this grant a new user's
    // login 500s on /v1/auth/me (surfaced to the browser as a CORS error).
    expect(migrationSql).toMatch(
      /GRANT[\s\S]*UPDATE[\s\S]*ON TABLE public\.app_user[\s\S]*TO wren_authorizer/i,
    );
  });
});
