/**
 * Property-based test: de-identification preserves aggregate value (Task 14.2).
 *
 * Feature: wren-writing-coach, Property 28: De-identification preserves aggregate value
 *
 * Design Property 28: For any set of activity-log events, the aggregate
 * analytics computed before de-identification equal those computed after
 * de-identification, and no raw actor identity remains in the de-identified
 * events.
 *
 * Validates: Requirements 44.4
 */
import fc from 'fast-check';

import { FakeDb } from './fakeDb';
import {
  deidentifyEvents,
  pseudonymForActor,
  recordActivityEvent,
  type RecordActivityEventInput,
} from './activityLogService';
import { wrenProperty } from '../../../testing/typescript/property';

const ORIGINAL_SALT = process.env.WREN_ACTIVITY_PSEUDONYM_SALT;

beforeAll(() => {
  process.env.WREN_ACTIVITY_PSEUDONYM_SALT = 'test-salt-property-28';
});

afterAll(() => {
  process.env.WREN_ACTIVITY_PSEUDONYM_SALT = ORIGINAL_SALT;
});

/** Arbitrary user id (the raw actor identity that must not appear in output). */
const userIdArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** Arbitrary verb. */
const verbArb = fc.constantFrom('uploaded', 'requested', 'generated', 'regenerated', 'deleted', 'granted');

/** Arbitrary object type. */
const objectTypeArb = fc.constantFrom('Document', 'AiDebrief', 'Override', 'AccessGrant', 'ErrorCategory');

/** Arbitrary object ref. */
const objectRefArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Arbitrary optional document type id. */
const optDtIdArb = fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined });

/** An activity event input for generation. */
const eventInputArb = fc.record({
  actorUserId: userIdArb,
  verb: verbArb,
  objectType: objectTypeArb,
  objectRef: objectRefArb,
  documentTypeId: optDtIdArb,
}) as fc.Arbitrary<RecordActivityEventInput>;

/**
 * Compute a simple aggregate: count of events grouped by actorPseudonym.
 * This is the key aggregate that must be invariant across de-identification.
 */
function aggregateByActor(events: readonly { actorPseudonym: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.actorPseudonym, (counts.get(event.actorPseudonym) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compute a second aggregate: count of events grouped by verb.
 * This verifies verb-level aggregates are also preserved.
 */
function aggregateByVerb(events: readonly { verb: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.verb, (counts.get(event.verb) ?? 0) + 1);
  }
  return counts;
}

describe('Property 28: De-identification preserves aggregate value', () => {
  it('aggregate analytics computed before de-identification equal those computed after', async () => {
    await wrenProperty(
      { number: 28, text: 'De-identification preserves aggregate value' },
      fc.asyncProperty(
        fc.array(eventInputArb, { minLength: 1, maxLength: 20 }),
        async (inputs) => {
          const db = new FakeDb();
          const events = [];
          for (const input of inputs) {
            events.push(await recordActivityEvent(input, db));
          }

          const beforeByActor = aggregateByActor(events);
          const beforeByVerb = aggregateByVerb(events);

          const deidentified = deidentifyEvents(events);

          const afterByActor = aggregateByActor(deidentified);
          const afterByVerb = aggregateByVerb(deidentified);

          // Aggregates must be identical before and after.
          if (beforeByActor.size !== afterByActor.size) return false;
          for (const [key, value] of beforeByActor) {
            if (afterByActor.get(key) !== value) return false;
          }
          if (beforeByVerb.size !== afterByVerb.size) return false;
          for (const [key, value] of beforeByVerb) {
            if (afterByVerb.get(key) !== value) return false;
          }

          return true;
        },
      ),
    );
  });

  it('no raw actor identity (userId) remains as the actorPseudonym in de-identified events', async () => {
    await wrenProperty(
      { number: 28, text: 'De-identification preserves aggregate value' },
      fc.asyncProperty(
        fc.array(eventInputArb, { minLength: 1, maxLength: 15 }),
        async (inputs) => {
          const db = new FakeDb();
          const events = [];
          for (const input of inputs) {
            events.push(await recordActivityEvent(input, db));
          }

          const deidentified = deidentifyEvents(events);

          // Collect all raw userIds from the inputs.
          const rawIds = new Set(inputs.map((i) => i.actorUserId));

          // Verify none of the raw ids appear as the actorPseudonym field
          // (the pseudonym must be a one-way derivation, never the raw id).
          for (const event of deidentified) {
            if (rawIds.has(event.actorPseudonym)) return false;
          }

          // Also verify the actorPseudonym is never equal to any raw userId.
          for (const rawId of rawIds) {
            if (deidentified.some((e) => e.actorPseudonym === rawId)) return false;
          }

          return true;
        },
      ),
    );
  });

  it('the pseudonym for the same actor is always identical (stable grouping)', () => {
    wrenProperty(
      { number: 28, text: 'De-identification preserves aggregate value' },
      fc.property(userIdArb, (userId) => {
        const p1 = pseudonymForActor(userId);
        const p2 = pseudonymForActor(userId);
        return p1 === p2;
      }),
    );
  });

  it('different actors get different pseudonyms (correct per-actor aggregation)', () => {
    wrenProperty(
      { number: 28, text: 'De-identification preserves aggregate value' },
      fc.property(userIdArb, userIdArb, (userId1, userId2) => {
        // Skip when the two generated ids happen to be the same.
        if (userId1 === userId2) return true;
        return pseudonymForActor(userId1) !== pseudonymForActor(userId2);
      }),
    );
  });
});
