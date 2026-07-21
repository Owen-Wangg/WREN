/**
 * Property-based test: usage attribution and most-restrictive enforcement (Task 13.3).
 *
 * Feature: wren-writing-coach, Property 29: Usage attribution and most-restrictive enforcement
 *
 * Design Property 29: For any feedback-generating action, usage is attributed
 * to exactly the set {target Document Type, platform}; given the configured
 * limits and current counters for those scopes, the action is allowed iff every
 * applicable scope is below its limit, and when blocked the response identifies
 * a scope that is at or over its limit.
 *
 * Validates: Requirements 54.2, 54.3, 54.4
 */
import fc from 'fast-check';

import { FakeDb } from './fakeDb';
import { applicableScopes, checkAndReserve } from './usageEnforcementService';
import { wrenProperty } from '../../../testing/typescript/property';

/** Arbitrary user id. */
const userIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Arbitrary document type id. */
const dtIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Arbitrary positive limit value (1–1000). */
const limitArb = fc.integer({ min: 1, max: 1000 });

/** Arbitrary consumed counter value (0–1000). */
const consumedArb = fc.integer({ min: 0, max: 1000 });

/** A period start for all tests. */
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z');

describe('Property 29: Usage attribution and most-restrictive enforcement', () => {
  it('applicableScopes always returns exactly {platform, documentType} — never a department scope (Req 54.2)', () => {
    wrenProperty(
      { number: 29, text: 'Usage attribution and most-restrictive enforcement' },
      fc.property(userIdArb, dtIdArb, (userId, documentTypeId) => {
        const scopes = applicableScopes({ userId, documentTypeId });

        // Exactly two scopes: platform and the target Document Type.
        if (scopes.length !== 2) return false;

        const kinds = scopes.map((s) => s.kind).sort();
        if (kinds[0] !== 'documentType' || kinds[1] !== 'platform') return false;

        // The documentType scope carries the correct id.
        const dtScope = scopes.find((s) => s.kind === 'documentType') as
          | { kind: 'documentType'; documentTypeId: string }
          | undefined;
        if (!dtScope || dtScope.documentTypeId !== documentTypeId) return false;

        // Never includes a department scope.
        return !scopes.some((s) => (s as { kind: string }).kind === 'department');
      }),
    );
  });

  it('action is allowed iff EVERY applicable scope is below its limit (Req 54.3)', async () => {
    await wrenProperty(
      { number: 29, text: 'Usage attribution and most-restrictive enforcement' },
      fc.asyncProperty(
        userIdArb,
        dtIdArb,
        limitArb,
        limitArb,
        consumedArb,
        consumedArb,
        async (userId, dtId, platformLimit, dtLimit, platformConsumed, dtConsumed) => {
          const db = new FakeDb();
          db.seedUsageLimit({ id: 'lp', scope_kind: 'platform', scope_id: null, limit_value: platformLimit });
          db.seedUsageLimit({ id: 'ldt', scope_kind: 'documentType', scope_id: dtId, limit_value: dtLimit });

          if (platformConsumed > 0) {
            db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: platformConsumed });
          }
          if (dtConsumed > 0) {
            db.seedUsageCounter({ scope_kind: 'documentType', scope_id: dtId, period_start: PERIOD_START, consumed: dtConsumed });
          }

          const decision = await checkAndReserve({ userId, documentTypeId: dtId }, PERIOD_START, db);

          const platformUnderLimit = platformConsumed < platformLimit;
          const dtUnderLimit = dtConsumed < dtLimit;
          const shouldBeAllowed = platformUnderLimit && dtUnderLimit;

          return decision.allowed === shouldBeAllowed;
        },
      ),
    );
  });

  it('when blocked, the response identifies a scope that is at or over its limit (Req 54.4)', async () => {
    await wrenProperty(
      { number: 29, text: 'Usage attribution and most-restrictive enforcement' },
      fc.asyncProperty(
        userIdArb,
        dtIdArb,
        limitArb,
        limitArb,
        consumedArb,
        consumedArb,
        async (userId, dtId, platformLimit, dtLimit, platformConsumed, dtConsumed) => {
          const db = new FakeDb();
          db.seedUsageLimit({ id: 'lp', scope_kind: 'platform', scope_id: null, limit_value: platformLimit });
          db.seedUsageLimit({ id: 'ldt', scope_kind: 'documentType', scope_id: dtId, limit_value: dtLimit });

          if (platformConsumed > 0) {
            db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: platformConsumed });
          }
          if (dtConsumed > 0) {
            db.seedUsageCounter({ scope_kind: 'documentType', scope_id: dtId, period_start: PERIOD_START, consumed: dtConsumed });
          }

          const decision = await checkAndReserve({ userId, documentTypeId: dtId }, PERIOD_START, db);

          if (!decision.allowed) {
            // blockedScope must name a scope that is actually at or over its limit.
            if (!decision.blockedScope) return false;
            if (!decision.message) return false;

            if (decision.blockedScope === 'platform') {
              return platformConsumed >= platformLimit;
            }
            if (decision.blockedScope === 'documentType') {
              return dtConsumed >= dtLimit;
            }
            return false; // Unknown scope — should not happen.
          }
          return true; // allowed — nothing to check about blockedScope.
        },
      ),
    );
  });

  it('on success, both counters are incremented; on failure, neither is (atomic reservation)', async () => {
    await wrenProperty(
      { number: 29, text: 'Usage attribution and most-restrictive enforcement' },
      fc.asyncProperty(
        dtIdArb,
        limitArb,
        limitArb,
        consumedArb,
        consumedArb,
        async (dtId, platformLimit, dtLimit, platformConsumed, dtConsumed) => {
          const db = new FakeDb();
          db.seedUsageLimit({ id: 'lp', scope_kind: 'platform', scope_id: null, limit_value: platformLimit });
          db.seedUsageLimit({ id: 'ldt', scope_kind: 'documentType', scope_id: dtId, limit_value: dtLimit });

          if (platformConsumed > 0) {
            db.seedUsageCounter({ scope_kind: 'platform', scope_id: null, period_start: PERIOD_START, consumed: platformConsumed });
          }
          if (dtConsumed > 0) {
            db.seedUsageCounter({ scope_kind: 'documentType', scope_id: dtId, period_start: PERIOD_START, consumed: dtConsumed });
          }

          const decision = await checkAndReserve({ userId: 'u1', documentTypeId: dtId }, PERIOD_START, db);

          const finalPlatform = db.usageCounters.find(
            (c) => c.scope_kind === 'platform' && c.period_start.toString() === PERIOD_START.toString(),
          )?.consumed ?? 0;
          const finalDt = db.usageCounters.find(
            (c) => c.scope_kind === 'documentType' && c.scope_id === dtId && c.period_start.toString() === PERIOD_START.toString(),
          )?.consumed ?? 0;

          if (decision.allowed) {
            // Both incremented by exactly 1.
            return finalPlatform === platformConsumed + 1 && finalDt === dtConsumed + 1;
          } else {
            // Neither changed.
            return finalPlatform === platformConsumed && finalDt === dtConsumed;
          }
        },
      ),
    );
  });
});
