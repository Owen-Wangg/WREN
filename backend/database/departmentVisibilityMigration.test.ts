import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(__dirname, 'migrations', '0002_department_visibility.sql'),
  'utf8',
);

describe('department visibility migration', () => {
  it('adds a visible-by-default constrained Department state', () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS visibility_state text NOT NULL DEFAULT 'VISIBLE'/i);
    expect(migrationSql).toMatch(/visibility_state IN \('VISIBLE', 'PERMITTED_ONLY'\)/i);
  });

  it('creates soft-revoked Department visibility grants with lifecycle foreign keys', () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.department_visibility_grant/i);
    expect(migrationSql).toMatch(/department_id uuid NOT NULL REFERENCES public\.department\(id\) ON DELETE CASCADE/i);
    expect(migrationSql).toMatch(/user_id uuid NOT NULL REFERENCES public\.app_user\(id\) ON DELETE CASCADE/i);
    expect(migrationSql).toMatch(/granted_by uuid REFERENCES public\.app_user\(id\) ON DELETE SET NULL/i);
    expect(migrationSql).toMatch(/revoked_at timestamp with time zone/i);
  });

  it('prevents duplicate active grants and indexes both lookup directions', () => {
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_department_visibility_grant_active[\s\S]*\(department_id, user_id\)[\s\S]*WHERE revoked_at IS NULL/i);
    expect(migrationSql).toMatch(/idx_department_visibility_grant_user_active[\s\S]*\(user_id, department_id\)/i);
    expect(migrationSql).toMatch(/idx_department_visibility_grant_department_active[\s\S]*\(department_id, granted_at, id\)/i);
  });
});
