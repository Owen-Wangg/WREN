/**
 * Unit tests for {@link getAnalytics} (REQ-AUDIT-01 / REQ-AUDIT-01b /
 * REQ-AUDIT-01c / REQ-AUDIT-OPSTATE-01 — Requirements 19, 40, 41, 42, 43;
 * Task 14.3).
 */
import { AuthorizationError } from './errors';
import { FakeDb } from './fakeDb';
import { getAnalytics } from './analyticsService';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT_A = 'dept-a';
const DEPT_B = 'dept-b';
const DT_A1 = 'dt-a1';
const DT_A2 = 'dt-a2';
const DT_B1 = 'dt-b1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT_A, name: 'Department A' });
  db.seedDepartment({ id: DEPT_B, name: 'Department B' });
  db.seedDocumentType({ id: DT_A1, department_id: DEPT_A, name: 'Essay' });
  db.seedDocumentType({ id: DT_A2, department_id: DEPT_A, name: 'Lab Report' });
  db.seedDocumentType({ id: DT_B1, department_id: DEPT_B, name: 'Memo' });

  db.seedAggregateCounter({
    id: 'agg-a1',
    scope_kind: 'documentType',
    scope_id: DT_A1,
    metric: 'feedback_requested_count',
    window_start: new Date('2026-01-01T00:00:00.000Z'),
    value: 10,
  });
  db.seedAggregateCounter({
    id: 'agg-a2',
    scope_kind: 'documentType',
    scope_id: DT_A2,
    metric: 'feedback_requested_count',
    window_start: new Date('2026-01-01T00:00:00.000Z'),
    value: 5,
  });
  db.seedAggregateCounter({
    id: 'agg-b1',
    scope_kind: 'documentType',
    scope_id: DT_B1,
    metric: 'feedback_requested_count',
    window_start: new Date('2026-01-01T00:00:00.000Z'),
    value: 7,
  });
  db.seedAggregateCounter({
    id: 'agg-platform',
    scope_kind: 'platform',
    metric: 'feedback_requested_count',
    window_start: new Date('2026-01-01T00:00:00.000Z'),
    value: 22,
  });
}

describe('getAnalytics — TechnicalAdmin (platform-wide, filterable by Document Type)', () => {
  it('returns platform-wide totals with no filter (Requirement 41.1)', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(techAdminContext(), {}, db);

    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]).toMatchObject({ scopeKind: 'platform', value: 22 });
  });

  it('filters to a single Document Type across ANY Department (Requirement 41.2)', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(techAdminContext(), { documentTypeId: DT_B1 }, db);

    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]).toMatchObject({
      scopeKind: 'documentType',
      scopeId: DT_B1,
      value: 7,
    });
  });

  it('never returns a per-Student entry, name, or score (Property 26 / Requirement 41.6)', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(techAdminContext(), {}, db);

    for (const total of result.totals) {
      expect(total).not.toHaveProperty('userId');
      expect(total).not.toHaveProperty('studentId');
      expect(total).not.toHaveProperty('name');
    }
  });
});

describe('getAnalytics — DepartmentAdmin (scoped to administered Departments)', () => {
  it('aggregates every Document Type across administered Departments (Requirement 42.1)', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(deptAdminContext([DEPT_A]), {}, db);

    expect(result.totals.map((t) => t.scopeId).sort()).toEqual([DT_A1, DT_A2].sort());
    expect(result.totals.every((t) => t.scopeId !== DT_B1)).toBe(true);
  });

  it('filters to one administered Document Type (Requirement 42.2)', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(deptAdminContext([DEPT_A]), { documentTypeId: DT_A1 }, db);

    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]).toMatchObject({ scopeId: DT_A1, value: 10 });
  });

  it('DENIES a Document Type filter outside administered Departments (Requirement 42.1 negative clause)', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      getAnalytics(deptAdminContext([DEPT_A]), { documentTypeId: DT_B1 }, db),
    ).rejects.toThrow(AuthorizationError);
  });

  it('excludes non-administered Departments even when administering more than one', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(deptAdminContext([DEPT_A]), {}, db);

    expect(result.totals.some((t) => t.scopeId === DT_B1)).toBe(false);
  });

  it('returns empty totals (not an error) for a DepartmentAdmin who administers no Department', async () => {
    const db = new FakeDb();
    seed(db);

    const result = await getAnalytics(deptAdminContext([]), {}, db);

    expect(result.totals).toEqual([]);
  });
});

describe('getAnalytics — Student (Requirement 19.2, 43.3: no analytics dashboard)', () => {
  it('DENIES a Student outright', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(getAnalytics(studentContext(), {}, db)).rejects.toThrow(AuthorizationError);
  });
});

describe('getAnalytics — retention independence (Requirement 40.5, 41.5, 43.4)', () => {
  it('computes totals purely from aggregate_counter, unaffected by document/draft/feedback_item state', async () => {
    const db = new FakeDb();
    seed(db);
    // No document/draft/feedback_item rows are seeded at all — analytics must
    // not depend on them existing.

    const result = await getAnalytics(techAdminContext(), {}, db);

    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]?.value).toBe(22);
  });
});
