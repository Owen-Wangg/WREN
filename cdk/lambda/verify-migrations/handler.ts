/**
 * Verification Lambda — checks that migrations were applied and seed data exists.
 * Used for smoke testing after deployment.
 */
import { createSql } from '@wren/db-node';

interface VerificationResult {
  migrations_applied: number;
  tables_exist: {
    app_user: boolean;
    department: boolean;
    document_type: boolean;
    role_assignment: boolean;
    feedback_item: boolean;
  };
  seed_data: {
    departments: number;
    document_types: number;
    content_types: number;
  };
}

export async function handler(): Promise<VerificationResult> {
  const sql = createSql();
  try {
    // Check applied migrations
    const migrations = await sql.unsafe('SELECT COUNT(*) as count FROM schema_migrations');
    const migrationsApplied = (migrations[0] as any).count;

    // Check tables exist
    const tableCheckQuery = `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    `;

    const tableResults = await Promise.all([
      sql.unsafe(tableCheckQuery, ['app_user']),
      sql.unsafe(tableCheckQuery, ['department']),
      sql.unsafe(tableCheckQuery, ['document_type']),
      sql.unsafe(tableCheckQuery, ['role_assignment']),
      sql.unsafe(tableCheckQuery, ['feedback_item']),
    ]);

    // Check seed data exists
    const seedCounts = await Promise.all([
      sql.unsafe('SELECT COUNT(*) as count FROM department'),
      sql.unsafe('SELECT COUNT(*) as count FROM document_type'),
      sql.unsafe('SELECT COUNT(*) as count FROM content_type'),
    ]);

    return {
      migrations_applied: migrationsApplied,
      tables_exist: {
        app_user: tableResults[0].length > 0,
        department: tableResults[1].length > 0,
        document_type: tableResults[2].length > 0,
        role_assignment: tableResults[3].length > 0,
        feedback_item: tableResults[4].length > 0,
      },
      seed_data: {
        departments: (seedCounts[0][0] as any).count,
        document_types: (seedCounts[1][0] as any).count,
        content_types: (seedCounts[2][0] as any).count,
      },
    };
  } finally {
    await sql.end();
  }
}
