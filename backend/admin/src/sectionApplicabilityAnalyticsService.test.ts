/**
 * Unit tests for {@link getSectionApplicabilityAnalytics}.
 *
 * Uses a minimal in-memory FakeDb that interprets the exact parameterized SQL
 * the service issues — same pattern as analyticsService.test.ts. No real
 * database required.
 */
import { AuthorizationError } from './errors';
import { getSectionApplicabilityAnalytics } from './sectionApplicabilityAnalyticsService';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import type { QueryExecutor } from './db';

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

const DEPT_A = 'dept-a';
const DEPT_B = 'dept-b';
const DT_A = 'dt-a';
const DT_B = 'dt-b';
const CAT_1 = 'cat-00000000-0000-0000-0000-000000000001';
const CAT_2 = 'cat-00000000-0000-0000-0000-000000000002';
const CAT_3 = 'cat-00000000-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// Minimal FakeDb
// ---------------------------------------------------------------------------

interface DocTypeRow { id: string; department_id: string }
interface VoteRow {
  document_id: string;
  document_type_id: string;
  error_category_id: string;
  category_name: string;
  applicable: boolean;
  updated_at: string;
}

class FakeDb implements QueryExecutor {
  private readonly docTypes: DocTypeRow[] = [];
  private readonly votes: VoteRow[] = [];

  seedDocumentType(id: string, departmentId: string): void {
    this.docTypes.push({ id, department_id: departmentId });
  }

  seedVote(
    documentTypeId: string,
    errorCategoryId: string,
    categoryName: string,
    applicable: boolean,
    updatedAt = '2026-07-01T00:00:00Z',
  ): void {
    this.votes.push({
      document_id: `doc-for-${documentTypeId}`,
      document_type_id: documentTypeId,
      error_category_id: errorCategoryId,
      category_name: categoryName,
      applicable,
      updated_at: updatedAt,
    });
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const norm = text.replace(/\s+/g, ' ').trim().toLowerCase();

    // getDepartmentId: SELECT department_id FROM document_type WHERE id = $1
    if (norm.startsWith('select department_id from document_type')) {
      const id = params[0] as string;
      const row = this.docTypes.find((r) => r.id === id);
      if (!row) return [];
      return [{ department_id: row.department_id }] as unknown as Row[];
    }

    // Aggregation query (starts with SELECT ec.id)
    if (norm.startsWith('select') && norm.includes('category_id') && norm.includes('debrief_section_applicability')) {
      const documentTypeId = params[0] as string;
      const relevant = this.votes.filter((v) => v.document_type_id === documentTypeId);

      // Group by error_category_id
      const grouped = new Map<string, { name: string; applicable: number; notApplicable: number; maxUpdatedAt: string }>();
      for (const v of relevant) {
        const entry = grouped.get(v.error_category_id) ?? {
          name: v.category_name,
          applicable: 0,
          notApplicable: 0,
          maxUpdatedAt: v.updated_at,
        };
        if (v.applicable) {
          entry.applicable += 1;
        } else {
          entry.notApplicable += 1;
        }
        if (v.updated_at > entry.maxUpdatedAt) entry.maxUpdatedAt = v.updated_at;
        grouped.set(v.error_category_id, entry);
      }

      // Filter: total > 0 (always true here since seeded), then sort by notApplicable/total DESC
      const rows = Array.from(grouped.entries())
        .map(([id, g]) => ({
          category_id: id,
          category_name: g.name,
          applicable_count: String(g.applicable),
          not_applicable_count: String(g.notApplicable),
          total: String(g.applicable + g.notApplicable),
          as_of: g.maxUpdatedAt,
        }))
        .sort((a, b) => {
          const pctA = parseInt(a.not_applicable_count, 10) / parseInt(a.total, 10);
          const pctB = parseInt(b.not_applicable_count, 10) / parseInt(b.total, 10);
          if (pctB !== pctA) return pctB - pctA;
          return a.category_name.localeCompare(b.category_name);
        });

      return rows as unknown as Row[];
    }

    throw new Error(`FakeDb: unrecognised query: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): FakeDb {
  const db = new FakeDb();
  db.seedDocumentType(DT_A, DEPT_A);
  db.seedDocumentType(DT_B, DEPT_B);
  return db;
}

// ---------------------------------------------------------------------------
// Tests: empty / no-data cases
// ---------------------------------------------------------------------------

describe('getSectionApplicabilityAnalytics — empty states', () => {
  it('returns empty sections and null asOf when no votes exist', async () => {
    const db = makeDb();
    const result = await getSectionApplicabilityAnalytics(
      techAdminContext(),
      DT_A,
      db,
    );
    expect(result.sections).toHaveLength(0);
    expect(result.asOf).toBeNull();
  });

  it('throws NotFoundError for an unknown documentTypeId', async () => {
    const db = makeDb();
    await expect(
      getSectionApplicabilityAnalytics(techAdminContext(), 'no-such-type', db),
    ).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests: aggregation correctness
// ---------------------------------------------------------------------------

describe('getSectionApplicabilityAnalytics — aggregation', () => {
  it('counts applicable and not-applicable votes separately', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', true);
    db.seedVote(DT_A, CAT_1, 'Clarity', true);
    db.seedVote(DT_A, CAT_1, 'Clarity', false);

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);

    expect(result.sections).toHaveLength(1);
    const row = result.sections[0]!;
    expect(row.categoryName).toBe('Clarity');
    expect(row.applicableCount).toBe(2);
    expect(row.notApplicableCount).toBe(1);
    expect(row.total).toBe(3);
  });

  it('computes notApplicablePct to one decimal', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', false);
    db.seedVote(DT_A, CAT_1, 'Clarity', false);
    db.seedVote(DT_A, CAT_1, 'Clarity', true);

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.sections[0]!.notApplicablePct).toBeCloseTo(66.7, 1);
  });

  it('reports notApplicablePct of 0 when all votes are applicable', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', true);
    db.seedVote(DT_A, CAT_1, 'Clarity', true);

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.sections[0]!.notApplicablePct).toBe(0);
  });

  it('reports notApplicablePct of 100 when all votes are not-applicable', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', false);
    db.seedVote(DT_A, CAT_1, 'Clarity', false);

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.sections[0]!.notApplicablePct).toBe(100);
  });

  it('tracks multiple sections independently', async () => {
    const db = makeDb();
    // CAT_1: 1/2 not-applicable = 50%
    db.seedVote(DT_A, CAT_1, 'Clarity', false);
    db.seedVote(DT_A, CAT_1, 'Clarity', true);
    // CAT_2: 0/3 not-applicable = 0%
    db.seedVote(DT_A, CAT_2, 'Structure', true);
    db.seedVote(DT_A, CAT_2, 'Structure', true);
    db.seedVote(DT_A, CAT_2, 'Structure', true);

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.sections).toHaveLength(2);
    // Sorted descending by not-applicable pct — CAT_1 (50%) first
    expect(result.sections[0]!.categoryId).toBe(CAT_1);
    expect(result.sections[1]!.categoryId).toBe(CAT_2);
  });

  it('sorts sections descending by not-applicable percentage', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Alpha', false);  // 100% not-applicable
    db.seedVote(DT_A, CAT_2, 'Beta', false);
    db.seedVote(DT_A, CAT_2, 'Beta', true);    // 50% not-applicable
    db.seedVote(DT_A, CAT_3, 'Gamma', true);   // 0% not-applicable

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.sections.map((s) => s.categoryId)).toEqual([CAT_1, CAT_2, CAT_3]);
  });

  it('reports the latest updated_at across sections as asOf', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', false, '2026-06-01T00:00:00Z');
    db.seedVote(DT_A, CAT_2, 'Structure', true, '2026-07-15T00:00:00Z');

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.asOf).toBe('2026-07-15T00:00:00Z');
  });

  it('does not include votes from other document types', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', false);
    db.seedVote(DT_B, CAT_1, 'Clarity', false);  // different document type

    const result = await getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: authorization
// ---------------------------------------------------------------------------

describe('getSectionApplicabilityAnalytics — authorization', () => {
  it('allows TechnicalAdmin to query any document type', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', true);

    await expect(
      getSectionApplicabilityAnalytics(techAdminContext(), DT_A, db),
    ).resolves.toBeDefined();
  });

  it('allows DepartmentAdmin to query their own document type', async () => {
    const db = makeDb();
    db.seedVote(DT_A, CAT_1, 'Clarity', true);

    await expect(
      getSectionApplicabilityAnalytics(deptAdminContext([DEPT_A]), DT_A, db),
    ).resolves.toBeDefined();
  });

  it('denies DepartmentAdmin access to a document type in another department', async () => {
    const db = makeDb();

    await expect(
      getSectionApplicabilityAnalytics(deptAdminContext([DEPT_B]), DT_A, db),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies Student access', async () => {
    const db = makeDb();

    await expect(
      getSectionApplicabilityAnalytics(studentContext(), DT_A, db),
    ).rejects.toThrow(AuthorizationError);
  });
});
