/**
 * Property-based test: override lifecycle (Task 13.5).
 *
 * Feature: wren-writing-coach, Property 30: Override lifecycle
 *
 * Design Property 30: For any Student blocked by a Document-Type limit,
 * granting a temporary override permits that Student's feedback-generating
 * actions up to the override bounds within the scoped Document Type until
 * the usage period resets, after which the override expires and the standard
 * limit is enforced again.
 *
 * Validates: Requirements 54.5, 54.7, 54.8
 */
import fc from 'fast-check';

import { FakeDb } from './fakeDb';
import type { Override } from '@wren/types';

import { checkAndReserve, type ActiveOverride } from './usageEnforcementService';
import { isOverrideActive } from './overrideService';
import { wrenProperty } from '../../../testing/typescript/property';

/** A period start for all tests. */
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z');

const DT = 'dt-1';
const USER = 'user-1';

/** Arbitrary limit value (1-100 to keep tests fast). */
const limitArb = fc.integer({ min: 1, max: 100 });

/** Arbitrary additional override actions (1-50). */
const overrideArb = fc.integer({ min: 1, max: 50 });

/** A timestamp before the period end (active override). */
const beforeExpiryArb = fc.date({
  min: new Date('2026-06-01T00:00:00.000Z'),
  max: new Date('2026-06-30T23:59:59.999Z'),
});

/** A timestamp after the period end (expired override). */
const afterExpiryArb = fc.date({
  min: new Date('2026-08-01T00:00:00.001Z'),
  max: new Date('2099-01-01T00:00:00.000Z'),
});

function makeOverride(expiresAt: Date, additionalActions: number): Override {
  return {
    id: 'override-1',
    userId: USER,
    documentTypeId: DT,
    bounds: { additionalActions },
    reason: 'Test override',
    grantedBy: 'admin-1',
    expiresAt: expiresAt.toISOString(),
  };
}

describe('Property 30: Override lifecycle', () => {
  it('an override with a future expiresAt is active; a past expiresAt means expired (Req 54.7)', () => {
    wrenProperty(
      { number: 30, text: 'Override lifecycle' },
      fc.property(
        afterExpiryArb,
        overrideArb,
        beforeExpiryArb,
        (expiresAt, additionalActions, now) => {
          // Scenario A: expiresAt is after `now` → active.
          const active = makeOverride(expiresAt, additionalActions);
          if (!isOverrideActive(active, now)) return false;

          // Scenario B: expiresAt is before `now` → expired.
          const pastExpiry = new Date(now.getTime() - 1000); // 1 second before `now`
          const expired = makeOverride(pastExpiry, additionalActions);
          return !isOverrideActive(expired, now);
        },
      ),
    );
  });

  it('a blocked Student is unblocked by an active override up to the override bounds (Req 54.5, 54.8)', async () => {
    await wrenProperty(
      { number: 30, text: 'Override lifecycle' },
      fc.asyncProperty(limitArb, overrideArb, async (limit, additionalActions) => {
        // Start: Student is at the limit and blocked WITHOUT an override.
        const db = new FakeDb();
        db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: limit });
        db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: limit });

        const blocked = await checkAndReserve({ userId: USER, documentTypeId: DT }, PERIOD_START, db);
        if (blocked.allowed) return false; // Should be blocked without an override.

        // Grant an active override.
        const activeOverride: ActiveOverride = { additionalActions };

        // Now the student can act — up to `limit + additionalActions`.
        const unblocked = await checkAndReserve(
          { userId: USER, documentTypeId: DT },
          PERIOD_START,
          db,
          activeOverride,
        );
        if (!unblocked.allowed) return false; // Should be unblocked with an override.

        // Exhaust the override bound: consume up to limit + additionalActions.
        // We already consumed 1 via the unblocked call above (counter now = limit + 1).
        for (let i = 1; i < additionalActions; i++) {
          const result = await checkAndReserve(
            { userId: USER, documentTypeId: DT },
            PERIOD_START,
            db,
            activeOverride,
          );
          if (!result.allowed) return false; // Still within override bounds.
        }

        // Now counter = limit + additionalActions → should be blocked again even with override.
        const exhausted = await checkAndReserve(
          { userId: USER, documentTypeId: DT },
          PERIOD_START,
          db,
          activeOverride,
        );
        return !exhausted.allowed;
      }),
    );
  });

  it('after an override expires (period reset), the standard limit is enforced again (Req 54.7)', async () => {
    await wrenProperty(
      { number: 30, text: 'Override lifecycle' },
      fc.asyncProperty(limitArb, overrideArb, async (limit, additionalActions) => {
        const db = new FakeDb();
        db.seedUsageLimit({ id: 'l1', scope_kind: 'documentType', scope_id: DT, limit_value: limit });
        db.seedUsageCounter({ scope_kind: 'documentType', scope_id: DT, period_start: PERIOD_START, consumed: limit });

        // With an active override, the Student can act.
        const activeOverride: ActiveOverride = { additionalActions };
        const allowed = await checkAndReserve(
          { userId: USER, documentTypeId: DT },
          PERIOD_START,
          db,
          activeOverride,
        );
        if (!allowed.allowed) return false;

        // After expiry, passing null for override (no active override) blocks again.
        // Reset counter to exactly at limit (simulating period hasn't reset counters
        // but the override has expired).
        // First undo the counter increment from the allowed call above.
        const dtCounter = db.usageCounters.find(
          (c) => c.scope_kind === 'documentType' && c.scope_id === DT,
        );
        if (dtCounter) {
          (dtCounter as { consumed: number }).consumed = limit;
        }

        const blockedAfterExpiry = await checkAndReserve(
          { userId: USER, documentTypeId: DT },
          PERIOD_START,
          db,
          null, // No active override — it expired.
        );
        return !blockedAfterExpiry.allowed;
      }),
    );
  });

  it('an override never raises the platform scope bound (Req 54.5 — scoped to Document Type)', async () => {
    await wrenProperty(
      { number: 30, text: 'Override lifecycle' },
      fc.asyncProperty(limitArb, overrideArb, async (platformLimit, additionalActions) => {
        const db = new FakeDb();
        db.seedUsageLimit({ id: 'lp', scope_kind: 'platform', scope_id: null, limit_value: platformLimit });
        db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: platformLimit });

        // Platform is at limit. An override (Document-Type-scoped) should NOT help.
        const activeOverride: ActiveOverride = { additionalActions };
        const decision = await checkAndReserve(
          { userId: USER, documentTypeId: DT },
          PERIOD_START,
          db,
          activeOverride,
        );

        if (decision.allowed) return false; // Should still be blocked at the platform scope.
        return decision.blockedScope === 'platform';
      }),
    );
  });
});
