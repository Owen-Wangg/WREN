/**
 * Unit tests for multi-scope usage attribution and most-restrictive-wins
 * enforcement (REQ-TOKEN-LIMIT-01 / Requirement 54; Task 13.2).
 */
import { FakeDb } from './fakeDb';
import { applicableScopes, checkAndReserve } from './usageEnforcementService';

const USER = 'user-1';
const DT = 'dt-1';
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z');

describe('applicableScopes (Requirement 54.2 — never a "home Department")', () => {
  it('returns exactly platform and the target Document Type', () => {
    const scopes = applicableScopes({ userId: USER, documentTypeId: DT });

    expect(scopes).toEqual([{ kind: 'platform' }, { kind: 'documentType', documentTypeId: DT }]);
  });

  it('never includes a department scope', () => {
    const scopes = applicableScopes({ userId: USER, documentTypeId: DT });

    expect(scopes.some((s) => (s as { kind: string }).kind === 'department')).toBe(false);
  });
});

describe('checkAndReserve — allows and reserves when under every limit', () => {
  it('allows the action and increments both platform and Document-Type counters', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 100 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 10 });

    const decision = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    expect(decision.allowed).toBe(true);
    const platformCounter = db.usageCounters.find((c) => c.scope_kind === 'platform');
    const dtCounter = db.usageCounters.find((c) => c.scope_kind === 'documentType' && c.scope_id === DT);
    expect(platformCounter?.consumed).toBe(1);
    expect(dtCounter?.consumed).toBe(1);
  });

  it('treats a scope with no configured limit as unbounded but still attributes/increments it', async () => {
    const db = new FakeDb();
    // No limits configured at all.

    const decision = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    expect(decision.allowed).toBe(true);
    expect(db.usageCounters).toHaveLength(2); // platform + documentType, both incremented
  });

  it('accumulates consumption across repeated calls', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: 5 });

    await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);
    await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);
    const decision = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    expect(decision.allowed).toBe(true);
    const dtCounter = db.usageCounters.find((c) => c.scope_kind === 'documentType' && c.scope_id === DT);
    expect(dtCounter?.consumed).toBe(3);
  });
});

describe('checkAndReserve — most-restrictive-wins blocking (Requirement 54.3, 54.4)', () => {
  it('blocks when the Document-Type scope is at its limit, even if platform has headroom', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 1000 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 2 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 2 });

    const decision = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    expect(decision.allowed).toBe(false);
    expect(decision.blockedScope).toBe('documentType');
    expect(decision.message).toMatch(new RegExp(DT));
  });

  it('blocks when the platform scope is at its limit, even if the Document Type has headroom', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 5 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 1000 });
    db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: 5 });

    const decision = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    expect(decision.allowed).toBe(false);
    expect(decision.blockedScope).toBe('platform');
    expect(decision.message).toMatch(/platform/i);
  });

  it('the message names the specific binding scope', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: 3 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 3 });

    const decision = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    expect(decision.message).toContain(DT);
    expect(decision.message).toContain('3/3');
  });

  it('does NOT increment any counter when the action is blocked (no partial reservation)', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 1000 });
    db.seedUsageLimit({ id: 'l2', scope_kind: 'documentType', scope_id: DT, limit_value: 1 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 1 });
    db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: 500 });

    await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);

    const platformCounter = db.usageCounters.find((c) => c.scope_kind === 'platform');
    const dtCounter = db.usageCounters.find((c) => c.scope_kind === 'documentType' && c.scope_id === DT);
    expect(platformCounter?.consumed).toBe(500); // untouched
    expect(dtCounter?.consumed).toBe(1); // untouched
  });
});

describe('checkAndReserve — active override raises the Document-Type bound (Requirement 54.5, 54.8)', () => {
  it('allows an action that would otherwise be blocked, up to the override bounds', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: 5 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 5 });

    const decision = await checkAndReserve(
      { userId: USER, documentTypeId: DT },
      PERIOD_START,
      db,
      { additionalActions: 3 },
    );

    expect(decision.allowed).toBe(true);
  });

  it('still blocks once the override-extended bound is also exhausted', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: 5 });
    db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: 8 });

    const decision = await checkAndReserve(
      { userId: USER, documentTypeId: DT },
      PERIOD_START,
      db,
      { additionalActions: 3 }, // effective limit 8; consumed already 8
    );

    expect(decision.allowed).toBe(false);
    expect(decision.blockedScope).toBe('documentType');
  });

  it('an override never raises the platform scope\'s bound', async () => {
    const db = new FakeDb();
    db.seedUsageLimit({ id: 'l1', scope_kind: 'platform', scope_id: null, limit_value: 5 });
    db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: 5 });

    const decision = await checkAndReserve(
      { userId: USER, documentTypeId: DT },
      PERIOD_START,
      db,
      { additionalActions: 100 }, // large override, but scoped to documentType only
    );

    expect(decision.allowed).toBe(false);
    expect(decision.blockedScope).toBe('platform');
  });
});
