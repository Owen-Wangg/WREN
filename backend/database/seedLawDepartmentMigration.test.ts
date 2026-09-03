import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(__dirname, 'migrations', '0006_seed_law_department.sql'),
  'utf8',
);

describe('seed Law example department migration', () => {
  it('seeds the Law department with its department-level prompt', () => {
    expect(migrationSql).toMatch(/INSERT INTO public\.department/i);
    expect(migrationSql).toContain('6ed1a3f1-45e6-4f5d-b1fd-b020b3193b22');
    // The department-level coaching prompt must ship with the example.
    expect(migrationSql).toContain('[Department Context]');
    expect(migrationSql).toContain('McGill Guide');
  });

  it('seeds the five Law document types', () => {
    for (const name of [
      'Appellate Factum',
      'Case Brief',
      'Legal Memorandum',
      'Opinion Letters',
      'Pleadings',
    ]) {
      expect(migrationSql).toContain(`'${name}'`);
    }
    // The stray manual-test category must NOT ship with the example.
    expect(migrationSql).not.toContain('3042c3f5-aa54-4159-a021-f0e9aa42a293');
  });

  it('is idempotent and forward-only (ON CONFLICT DO NOTHING, no updates/deletes)', () => {
    expect(migrationSql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    expect(migrationSql).toMatch(
      /ON CONFLICT \(document_type_id\) DO NOTHING/i,
    );
    // A seed must never mutate or remove existing rows.
    expect(migrationSql).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSql).not.toMatch(/\bDELETE\b/i);
  });

  it('inserts in foreign-key order: department, document_type, error_category, config', () => {
    const deptAt = migrationSql.indexOf('INSERT INTO public.department');
    const typeAt = migrationSql.indexOf('INSERT INTO public.document_type ');
    const categoryAt = migrationSql.indexOf('INSERT INTO public.error_category');
    const configAt = migrationSql.indexOf(
      'INSERT INTO public.document_type_config',
    );
    expect(deptAt).toBeGreaterThanOrEqual(0);
    expect(deptAt).toBeLessThan(typeAt);
    expect(typeAt).toBeLessThan(categoryAt);
    expect(categoryAt).toBeLessThan(configAt);
  });
});
