/**
 * Unit tests for {@link recordActivityEvent} / {@link listActivityEvents} /
 * {@link pseudonymForActor} / {@link deidentifyEvents} (REQ-ACTIVITY-LOG-01 /
 * Requirement 44; Task 14.1).
 */
import { FakeDb } from './fakeDb';
import {
  deidentifyEvents,
  listActivityEvents,
  pseudonymForActor,
  recordActivityEvent,
} from './activityLogService';

const ORIGINAL_SALT = process.env.WREN_ACTIVITY_PSEUDONYM_SALT;

beforeAll(() => {
  process.env.WREN_ACTIVITY_PSEUDONYM_SALT = 'test-salt-do-not-use-in-prod';
});

afterAll(() => {
  process.env.WREN_ACTIVITY_PSEUDONYM_SALT = ORIGINAL_SALT;
});

describe('pseudonymForActor', () => {
  it('is stable: the same userId always yields the same pseudonym', () => {
    expect(pseudonymForActor('user-1')).toBe(pseudonymForActor('user-1'));
  });

  it('differs across distinct userIds', () => {
    expect(pseudonymForActor('user-1')).not.toBe(pseudonymForActor('user-2'));
  });

  it('never returns the raw userId (one-way)', () => {
    const pseudonym = pseudonymForActor('user-1');
    expect(pseudonym).not.toBe('user-1');
    expect(pseudonym).not.toContain('user-1');
  });

  it('throws when the pseudonym salt is not configured (fails closed)', () => {
    const saved = process.env.WREN_ACTIVITY_PSEUDONYM_SALT;
    delete process.env.WREN_ACTIVITY_PSEUDONYM_SALT;
    expect(() => pseudonymForActor('user-1')).toThrow(/WREN_ACTIVITY_PSEUDONYM_SALT/);
    process.env.WREN_ACTIVITY_PSEUDONYM_SALT = saved;
  });
});

describe('recordActivityEvent', () => {
  it('persists an Actor–Verb–Object event with the required fields (Requirement 44.1)', async () => {
    const db = new FakeDb();

    const event = await recordActivityEvent(
      {
        actorUserId: 'user-1',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-1',
        documentTypeId: 'dt-1',
        departmentId: 'dept-1',
        context: { wordCount: 512 },
      },
      db,
    );

    expect(event).toMatchObject({
      verb: 'uploaded',
      objectType: 'Document',
      objectRef: 'doc-1',
      documentTypeId: 'dt-1',
      departmentId: 'dept-1',
      context: { wordCount: 512 },
    });
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
  });

  it('never persists the raw actorUserId — only a pseudonym (Requirement 44.4)', async () => {
    const db = new FakeDb();

    const event = await recordActivityEvent(
      { actorUserId: 'user-42', verb: 'requested', objectType: 'AiDebrief', objectRef: 'doc-9' },
      db,
    );

    expect(event.actorPseudonym).toBe(pseudonymForActor('user-42'));
    expect(event.actorPseudonym).not.toBe('user-42');
    expect(JSON.stringify(db.activityEvents)).not.toContain('user-42');
  });

  it('records the SAME pseudonym for the same actor across multiple events (aggregation-friendly)', async () => {
    const db = new FakeDb();

    const first = await recordActivityEvent(
      { actorUserId: 'user-7', verb: 'uploaded', objectType: 'Document', objectRef: 'doc-1' },
      db,
    );
    const second = await recordActivityEvent(
      { actorUserId: 'user-7', verb: 'requested', objectType: 'AiDebrief', objectRef: 'doc-1' },
      db,
    );

    expect(first.actorPseudonym).toBe(second.actorPseudonym);
  });

  it('is independent of document content — no mutation touches document/draft/feedback_item tables', async () => {
    const db = new FakeDb();
    const before = db.mutationCount;

    await recordActivityEvent(
      { actorUserId: 'user-1', verb: 'uploaded', objectType: 'Document', objectRef: 'doc-1' },
      db,
    );

    // Exactly one mutation (the activity_event insert) — nothing else touched.
    expect(db.mutationCount).toBe(before + 1);
    expect(db.activityEvents).toHaveLength(1);
  });

  it('accepts an explicit timestamp override for deterministic tests', async () => {
    const db = new FakeDb();
    const pinned = new Date('2026-01-15T00:00:00.000Z');

    const event = await recordActivityEvent(
      {
        actorUserId: 'user-1',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-1',
        timestamp: pinned,
      },
      db,
    );

    expect(event.timestamp).toBe(pinned.toISOString());
  });
});

describe('listActivityEvents', () => {
  it('filters by documentTypeId', async () => {
    const db = new FakeDb();
    await recordActivityEvent(
      {
        actorUserId: 'user-1',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-1',
        documentTypeId: 'dt-1',
      },
      db,
    );
    await recordActivityEvent(
      {
        actorUserId: 'user-2',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-2',
        documentTypeId: 'dt-2',
      },
      db,
    );

    const events = await listActivityEvents({ documentTypeId: 'dt-1' }, db);

    expect(events).toHaveLength(1);
    expect(events[0]?.documentTypeId).toBe('dt-1');
  });

  it('filters by departmentId', async () => {
    const db = new FakeDb();
    await recordActivityEvent(
      {
        actorUserId: 'user-1',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-1',
        departmentId: 'dept-1',
      },
      db,
    );
    await recordActivityEvent(
      {
        actorUserId: 'user-2',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-2',
        departmentId: 'dept-2',
      },
      db,
    );

    const events = await listActivityEvents({ departmentId: 'dept-1' }, db);

    expect(events).toHaveLength(1);
    expect(events[0]?.departmentId).toBe('dept-1');
  });

  it('returns every event, ordered by timestamp ascending, when no filter is given', async () => {
    const db = new FakeDb();
    await recordActivityEvent(
      {
        actorUserId: 'user-1',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-1',
        timestamp: new Date('2026-01-02T00:00:00.000Z'),
      },
      db,
    );
    await recordActivityEvent(
      {
        actorUserId: 'user-2',
        verb: 'uploaded',
        objectType: 'Document',
        objectRef: 'doc-2',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      },
      db,
    );

    const events = await listActivityEvents({}, db);

    expect(events.map((e) => e.objectRef)).toEqual(['doc-2', 'doc-1']);
  });
});

describe('deidentifyEvents (Property 28: de-identification preserves aggregate value)', () => {
  it('never leaves a raw actor identity on the returned events', async () => {
    const db = new FakeDb();
    const recorded = await recordActivityEvent(
      { actorUserId: 'user-1', verb: 'uploaded', objectType: 'Document', objectRef: 'doc-1' },
      db,
    );

    const [deidentified] = deidentifyEvents([recorded]);

    expect(deidentified?.actorPseudonym).toBe(recorded.actorPseudonym);
    expect(JSON.stringify(deidentified)).not.toContain('user-1');
  });

  it('preserves per-pseudonym aggregate grouping across de-identification', async () => {
    const db = new FakeDb();
    const events = await Promise.all([
      recordActivityEvent(
        { actorUserId: 'user-1', verb: 'uploaded', objectType: 'Document', objectRef: 'doc-1' },
        db,
      ),
      recordActivityEvent(
        { actorUserId: 'user-1', verb: 'requested', objectType: 'AiDebrief', objectRef: 'doc-1' },
        db,
      ),
      recordActivityEvent(
        { actorUserId: 'user-2', verb: 'uploaded', objectType: 'Document', objectRef: 'doc-2' },
        db,
      ),
    ]);

    const countByPseudonym = (list: readonly (typeof events)[number][]) => {
      const counts = new Map<string, number>();
      for (const event of list) {
        counts.set(event.actorPseudonym, (counts.get(event.actorPseudonym) ?? 0) + 1);
      }
      return counts;
    };

    const before = countByPseudonym(events);
    const after = countByPseudonym(deidentifyEvents(events));

    expect(after).toEqual(before);
  });
});
