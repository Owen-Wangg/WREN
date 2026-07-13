/**
 * Unit tests for usage-limit configuration and current-usage reporting
 * (REQ-USAGE-LIMITS-01 / Requirement 31; Task 13.1).
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  createUsageLimit,
  deleteUsageLimit,
  getUsageLimit,
  getUsageLimitForScope,
  getUsageReport,
  listUsageLimits,
  updateUsageLimit,
} from './usageLimitService';

const DT = 'dt-1';
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z');

describe('createUsageLimit (Requirement 31.1, 31.3)', () => {
  it('lets a TechnicalAdmin configure a platform-level limit', async () => {
    const db = new FakeDb();

    const limit = await createUsageLimit(
      techAdminContext(),
      { scope: { kind: 'platform' }, limitValue: 1000, period: 'monthly' },
      db,
    );

    expect(limit).toEqual({
      id: expect.any(String),
      scope: { kind: 'platform' },
      limitValue: 1000,
      period: 'monthly',
    });
  });

  it('lets a TechnicalAdmin configure a Document-Type-scoped limit', async () => {
    const db = new FakeDb();

    const limit = await createUsageLimit(
      techAdminContext(),
      { scope: { kind: 'documentType', documentTypeId: DT }, limitValue: 200, period: 'daily' },
      db,
    );

    expect(limit.scope).toEqual({ kind: 'documentType', documentTypeId: DT });
    expect(limit.limitValue).toBe(200);
  });

  it('persists the scope kind/id as columns, never a tenant-isolation boundary', async () => {
    const db = new FakeDb();

    await createUsageLimit(
      techAdminContext(),
      { scope: { kind: 'documentType', documentTypeId: DT }, limitValue: 50, period: 'monthly' },
      db,
    );

    const row = [...db.usageLimits.values()][0]!;
    expect(row.scope_kind).toBe('documentType');
    expect(row.scope_id).toBe(DT);
  });

  it('denies a DepartmentAdmin with no mutation — usage limits are a technical operation', async () => {
    const db = new FakeDb();

    await expect(
      createUsageLimit(
        deptAdminContext(['dept-1']),
        { scope: { kind: 'platform' }, limitValue: 1000, period: 'monthly' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();

    await expect(
      createUsageLimit(studentContext(), { scope: { kind: 'platform' }, limitValue: 1000, period: 'monthly' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('getUsageLimitForScope / listUsageLimits', () => {
  it('finds the platform-scoped limit', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 500 });

    const limit = await getUsageLimitForScope({ kind: 'platform' }, db);

    expect(limit?.limitValue).toBe(500);
  });

  it('finds a Document-Type-scoped limit and does not confuse it with platform', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 500 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 75 });

    const platformLimit = await getUsageLimitForScope({ kind: 'platform' }, db);
    const dtLimit = await getUsageLimitForScope({ kind: 'documentType', documentTypeId: DT }, db);

    expect(platformLimit?.limitValue).toBe(500);
    expect(dtLimit?.limitValue).toBe(75);
  });

  it('returns null when no limit is configured for the scope', async () => {
    const db = new FakeDb();

    const limit = await getUsageLimitForScope({ kind: 'documentType', documentTypeId: 'missing-dt' }, db);

    expect(limit).toBeNull();
  });

  it('lists every configured limit', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 500 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 75 });

    const limits = await listUsageLimits(db);

    expect(limits).toHaveLength(2);
  });
});

describe('updateUsageLimit', () => {
  it('updates the limit value (TechnicalAdmin only)', async () => {
    const db = new FakeDb();
    const created = await createUsageLimit(
      techAdminContext(),
      { scope: { kind: 'platform' }, limitValue: 100, period: 'monthly' },
      db,
    );

    const updated = await updateUsageLimit(techAdminContext(), created.id, { limitValue: 250 }, db);

    expect(updated.limitValue).toBe(250);
    expect(updated.period).toBe('monthly'); // unchanged
  });

  it('is a no-op returning the current record when the patch is empty', async () => {
    const db = new FakeDb();
    const created = await createUsageLimit(
      techAdminContext(),
      { scope: { kind: 'platform' }, limitValue: 100, period: 'monthly' },
      db,
    );
    const mutationsBefore = db.mutationCount;

    const result = await updateUsageLimit(techAdminContext(), created.id, {}, db);

    expect(result).toEqual(created);
    expect(db.mutationCount).toBe(mutationsBefore);
  });

  it('throws NotFoundError for an unknown limit', async () => {
    const db = new FakeDb();

    await expect(
      updateUsageLimit(techAdminContext(), 'missing', { limitValue: 10 }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DepartmentAdmin with no mutation', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 100 });
    const mutationsBefore = db.mutationCount;

    await expect(
      updateUsageLimit(deptAdminContext(['dept-1']), 'l1', { limitValue: 10 }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(mutationsBefore);
  });
});

describe('deleteUsageLimit', () => {
  it('removes a limit (TechnicalAdmin only)', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1' });

    const deleted = await deleteUsageLimit(techAdminContext(), 'l1', db);

    expect(deleted).toBe(true);
    expect(await getUsageLimit('l1', db)).toBeNull();
  });

  it('returns false for an unknown id with no mutation', async () => {
    const db = new FakeDb();

    const deleted = await deleteUsageLimit(techAdminContext(), 'missing', db);

    expect(deleted).toBe(false);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1' });

    await expect(deleteUsageLimit(studentContext(), 'l1', db)).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('getUsageReport (Requirement 31.2 — display current usage relative to the configured limit)', () => {
  it('returns null when no limit is configured for the scope', async () => {
    const db = new FakeDb();

    const report = await getUsageReport({ kind: 'platform' }, PERIOD_START, db);

    expect(report).toBeNull();
  });

  it('reports consumed=0 when a limit exists but no counter row yet', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 1000 });

    const report = await getUsageReport({ kind: 'platform' }, PERIOD_START, db);

    expect(report).toEqual({
      scope: { kind: 'platform' },
      limitValue: 1000,
      consumed: 0,
      remaining: 1000,
      periodStart: PERIOD_START.toISOString(),
    });
  });

  it('reports consumed/remaining from the matching counter row', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: 100 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 40 });

    const report = await getUsageReport({ kind: 'documentType', documentTypeId: DT }, PERIOD_START, db);

    expect(report?.consumed).toBe(40);
    expect(report?.remaining).toBe(60);
  });

  it('floors remaining at 0 when consumed exceeds the limit', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 50 });
    db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: 75 });

    const report = await getUsageReport({ kind: 'platform' }, PERIOD_START, db);

    expect(report?.consumed).toBe(75);
    expect(report?.remaining).toBe(0);
  });

  it('does not confuse counters from different periods', async () => {
    const db = new FakeDb();
    const priorPeriod = new Date('2026-06-01T00:00:00.000Z');
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 100 });
    db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: priorPeriod, consumed: 99 });

    const report = await getUsageReport({ kind: 'platform' }, PERIOD_START, db);

    // The current period has no counter row yet — prior period's consumption
    // must not leak into the current period's report.
    expect(report?.consumed).toBe(0);
  });

  it('does not confuse platform and Document-Type counters at the same period_start', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 100 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 100 });
    db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: 10 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 90 });

    const platformReport = await getUsageReport({ kind: 'platform' }, PERIOD_START, db);
    const dtReport = await getUsageReport({ kind: 'documentType', documentTypeId: DT }, PERIOD_START, db);

    expect(platformReport?.consumed).toBe(10);
    expect(dtReport?.consumed).toBe(90);
  });

  it('is read-only — never creates or mutates a counter/limit row', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 100 });
    const mutationsBefore = db.mutationCount;

    await getUsageReport({ kind: 'platform' }, PERIOD_START, db);

    expect(db.mutationCount).toBe(mutationsBefore);
  });
});
