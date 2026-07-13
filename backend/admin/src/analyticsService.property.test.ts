/**
 * Property-based test: analytics expose only all-users aggregates (Task 14.4).
 *
 * Feature: wren-writing-coach, Property 26: Analytics expose only all-users aggregates
 *
 * Design Property 26: For any analytics request by a Department Admin or
 * Technical Admin, the response contains only all-users aggregate totals
 * scoped correctly (Department Admin → Document Types within administered
 * Departments; Technical Admin → platform-wide, filterable by Document Type)
 * and contains no per-Student entries, per-Student scores, or named
 * per-Student activity.
 *
 * Validates: Requirements 40.1, 40.2, 40.6, 41.2, 41.3, 41.6, 42.1, 42.5, 19.1, 19.2, 43.2
 */
import fc from 'fast-check';

import { FakeDb } from './fakeDb';
import { getAnalytics } from './analyticsService';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import { wrenProperty } from '../../../testing/typescript/property';

/** Arbitrary department ids (1-3 departments). */
const deptIdsArb = fc.array(
  fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
  { minLength: 1, maxLength: 3 },
).map((ids) => [...new Set(ids)]); // deduplicate

/** Arbitrary document type id. */
const dtIdArb = fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0);

/** Arbitrary metric name. */
const metricArb = fc.constantFrom('feedback_requested_count', 'submissions_count', 'overrides_granted');

/** Arbitrary counter value (0-10000). */
const valueArb = fc.integer({ min: 0, max: 10000 });

interface SeedConfig {
  departments: string[];
  documentTypes: Array<{ id: string; departmentId: string }>;
  counters: Array<{ id: string; scopeKind: 'platform' | 'documentType'; scopeId: string | null; metric: string; value: number }>;
}

function seed(db: FakeDb, config: SeedConfig): void {
  for (const dept of config.departments) {
    db.seedDepartment({ id: dept, name: `Dept ${dept}` });
  }
  for (const dt of config.documentTypes) {
    db.seedDocumentType({ id: dt.id, department_id: dt.departmentId, name: `DT ${dt.id}` });
  }
  for (const counter of config.counters) {
    db.seedAggregateCounter({
      id: counter.id,
      scope_kind: counter.scopeKind,
      scope_id: counter.scopeId,
      metric: counter.metric,
      window_start: new Date('2026-01-01T00:00:00.000Z'),
      value: counter.value,
    });
  }
}

/** Verify no per-Student fields exist in any total. */
function hasNoPerStudentFields(totals: readonly Record<string, unknown>[]): boolean {
  const perStudentKeys = ['userId', 'studentId', 'name', 'email', 'firstName', 'lastName', 'perStudent'];
  for (const total of totals) {
    for (const key of perStudentKeys) {
      if (key in total) return false;
    }
  }
  return true;
}

describe('Property 26: Analytics expose only all-users aggregates', () => {
  it('TechnicalAdmin sees platform-wide totals with no per-Student data (Req 41.3, 41.6)', async () => {
    await wrenProperty(
      { number: 26, text: 'Analytics expose only all-users aggregates' },
      fc.asyncProperty(metricArb, valueArb, async (metric, value) => {
        const db = new FakeDb();
        seed(db, {
          departments: ['dept-a'],
          documentTypes: [{ id: 'dt-a', departmentId: 'dept-a' }],
          counters: [
            { id: 'c1', scopeKind: 'platform', scopeId: null, metric, value },
          ],
        });

        const result = await getAnalytics(techAdminContext(), {}, db);

        if (!hasNoPerStudentFields(result.totals as unknown as Record<string, unknown>[])) return false;
        return result.totals.length > 0 && result.totals.every((t) => t.scopeKind === 'platform');
      }),
    );
  });

  it('TechnicalAdmin can filter by Document Type across ANY Department (Req 41.2)', async () => {
    await wrenProperty(
      { number: 26, text: 'Analytics expose only all-users aggregates' },
      fc.asyncProperty(deptIdsArb, dtIdArb, metricArb, valueArb, async (depts, dtId, metric, value) => {
        const dept = depts[0]!;
        const db = new FakeDb();
        seed(db, {
          departments: depts,
          documentTypes: [{ id: dtId, departmentId: dept }],
          counters: [
            { id: 'c1', scopeKind: 'documentType', scopeId: dtId, metric, value },
          ],
        });

        const result = await getAnalytics(techAdminContext(), { documentTypeId: dtId }, db);

        if (!hasNoPerStudentFields(result.totals as unknown as Record<string, unknown>[])) return false;
        return result.totals.every((t) => t.scopeId === dtId);
      }),
    );
  });

  it('DepartmentAdmin sees only Document Types within administered Departments (Req 40.1, 42.1)', async () => {
    await wrenProperty(
      { number: 26, text: 'Analytics expose only all-users aggregates' },
      fc.asyncProperty(metricArb, valueArb, valueArb, async (metric, valueA, valueB) => {
        const db = new FakeDb();
        seed(db, {
          departments: ['dept-admin', 'dept-other'],
          documentTypes: [
            { id: 'dt-admin', departmentId: 'dept-admin' },
            { id: 'dt-other', departmentId: 'dept-other' },
          ],
          counters: [
            { id: 'c1', scopeKind: 'documentType', scopeId: 'dt-admin', metric, value: valueA },
            { id: 'c2', scopeKind: 'documentType', scopeId: 'dt-other', metric, value: valueB },
          ],
        });

        const result = await getAnalytics(deptAdminContext(['dept-admin']), {}, db);

        if (!hasNoPerStudentFields(result.totals as unknown as Record<string, unknown>[])) return false;

        // Must include only dt-admin, never dt-other.
        const scopeIds = result.totals.map((t) => t.scopeId);
        if (scopeIds.includes('dt-other')) return false;
        return scopeIds.every((id) => id === 'dt-admin');
      }),
    );
  });

  it('DepartmentAdmin is DENIED analytics for a Document Type outside administered Departments (Req 42.1 negative)', async () => {
    await wrenProperty(
      { number: 26, text: 'Analytics expose only all-users aggregates' },
      fc.asyncProperty(metricArb, valueArb, async (metric, value) => {
        const db = new FakeDb();
        seed(db, {
          departments: ['dept-admin', 'dept-other'],
          documentTypes: [
            { id: 'dt-admin', departmentId: 'dept-admin' },
            { id: 'dt-other', departmentId: 'dept-other' },
          ],
          counters: [
            { id: 'c1', scopeKind: 'documentType', scopeId: 'dt-other', metric, value },
          ],
        });

        try {
          await getAnalytics(deptAdminContext(['dept-admin']), { documentTypeId: 'dt-other' }, db);
          return false; // Should have thrown.
        } catch (err: unknown) {
          return (err as Error).constructor.name === 'AuthorizationError';
        }
      }),
    );
  });

  it('Student is always DENIED analytics access (Req 19.2, 43.2)', async () => {
    await wrenProperty(
      { number: 26, text: 'Analytics expose only all-users aggregates' },
      fc.asyncProperty(metricArb, async (metric) => {
        const db = new FakeDb();
        seed(db, {
          departments: ['dept-a'],
          documentTypes: [{ id: 'dt-a', departmentId: 'dept-a' }],
          counters: [
            { id: 'c1', scopeKind: 'platform', scopeId: null, metric, value: 100 },
          ],
        });

        try {
          await getAnalytics(studentContext(), {}, db);
          return false; // Should have thrown.
        } catch (err: unknown) {
          return (err as Error).constructor.name === 'AuthorizationError';
        }
      }),
    );
  });

  it('no result ever contains per-Student entries/scores/named activity regardless of data shape (Req 40.6, 41.6, 42.5)', async () => {
    await wrenProperty(
      { number: 26, text: 'Analytics expose only all-users aggregates' },
      fc.asyncProperty(
        fc.array(
          fc.record({ metric: metricArb, value: valueArb }),
          { minLength: 1, maxLength: 10 },
        ),
        async (counterConfigs) => {
          const db = new FakeDb();
          seed(db, {
            departments: ['dept-a'],
            documentTypes: [{ id: 'dt-a', departmentId: 'dept-a' }],
            counters: counterConfigs.map((c, i) => ({
              id: `c${i}`,
              scopeKind: 'documentType' as const,
              scopeId: 'dt-a',
              metric: c.metric,
              value: c.value,
            })),
          });

          const result = await getAnalytics(deptAdminContext(['dept-a']), {}, db);

          return hasNoPerStudentFields(result.totals as unknown as Record<string, unknown>[]);
        },
      ),
    );
  });
});
