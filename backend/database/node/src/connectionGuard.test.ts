import {
  classifyConnectionError,
  ConnectionGuard,
  DEFAULT_OPEN_MS,
  INVALID_PASSWORD_SQLSTATE,
  MAX_OPEN_MS,
  type GuardEvent,
} from './connectionGuard';

/**
 * Bounded failure guard (authorizer throttling remediation, Task 3).
 *
 * These tests pin the mandatory SAFETY PROPERTIES so a future change cannot
 * turn the guard into an availability problem:
 *   - only credential-class (28P01) failures may open it;
 *   - transient failures NEVER open it;
 *   - the open window is short and hard-capped;
 *   - a success closes it immediately;
 *   - open/close are observable.
 */

/** A deterministic clock whose value the test controls. */
function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('classifyConnectionError', () => {
  it('classifies Postgres 28P01 as a credential failure', () => {
    expect(classifyConnectionError({ code: INVALID_PASSWORD_SQLSTATE })).toBe('credential');
  });

  it('classifies everything else as transient (retryable)', () => {
    expect(classifyConnectionError({ code: 'ECONNREFUSED' })).toBe('transient');
    expect(classifyConnectionError({ code: 'ETIMEDOUT' })).toBe('transient');
    expect(classifyConnectionError(new Error('TLS handshake failed'))).toBe('transient');
    expect(classifyConnectionError(undefined)).toBe('transient');
    expect(classifyConnectionError(null)).toBe('transient');
    expect(classifyConnectionError('string error')).toBe('transient');
  });
});

describe('ConnectionGuard — credential-class failures', () => {
  it('opens on 28P01 and short-circuits until the bounded window elapses', () => {
    const clock = fakeClock();
    const guard = new ConnectionGuard(DEFAULT_OPEN_MS, { now: clock.now, log: () => {} });

    expect(guard.isOpen()).toBe(false);
    guard.recordFailure({ code: INVALID_PASSWORD_SQLSTATE });
    expect(guard.isOpen()).toBe(true);

    // Still open just before the window elapses.
    clock.advance(DEFAULT_OPEN_MS - 1);
    expect(guard.isOpen()).toBe(true);

    // Becomes probeable (half-open) the instant the window elapses.
    clock.advance(1);
    expect(guard.isOpen()).toBe(false);
  });

  it('never stays open longer than MAX_OPEN_MS even if a larger window is requested', () => {
    const clock = fakeClock();
    const guard = new ConnectionGuard(60_000, { now: clock.now, log: () => {} });
    guard.recordFailure({ code: INVALID_PASSWORD_SQLSTATE });

    clock.advance(MAX_OPEN_MS);
    expect(guard.isOpen()).toBe(false);
  });
});

describe('ConnectionGuard — transient failures never linger', () => {
  it('does NOT open on a transient failure', () => {
    const clock = fakeClock();
    const guard = new ConnectionGuard(DEFAULT_OPEN_MS, { now: clock.now, log: () => {} });

    guard.recordFailure({ code: 'ECONNREFUSED' });
    // A temporary DB/network blip must retry immediately — guard stays closed.
    expect(guard.isOpen()).toBe(false);
  });
});

describe('ConnectionGuard — immediate recovery', () => {
  it('closes at once on the first success', () => {
    const clock = fakeClock();
    const guard = new ConnectionGuard(DEFAULT_OPEN_MS, { now: clock.now, log: () => {} });

    guard.recordFailure({ code: INVALID_PASSWORD_SQLSTATE });
    expect(guard.isOpen()).toBe(true);

    guard.recordSuccess();
    expect(guard.isOpen()).toBe(false);
  });
});

describe('ConnectionGuard — observability', () => {
  it('logs open (with class + window) and close exactly once each', () => {
    const clock = fakeClock();
    const events: GuardEvent[] = [];
    const guard = new ConnectionGuard(DEFAULT_OPEN_MS, {
      now: clock.now,
      log: (e) => events.push(e),
    });

    guard.recordFailure({ code: INVALID_PASSWORD_SQLSTATE });
    // A second failure inside the same open window does not re-log open.
    guard.recordFailure({ code: INVALID_PASSWORD_SQLSTATE });
    guard.recordSuccess();

    expect(events).toEqual([
      { event: 'db_connection_guard_open', failureClass: 'credential', openMs: DEFAULT_OPEN_MS },
      { event: 'db_connection_guard_close' },
    ]);
  });

  it('does not log a close when nothing had failed', () => {
    const events: GuardEvent[] = [];
    const guard = new ConnectionGuard(DEFAULT_OPEN_MS, { log: (e) => events.push(e) });
    guard.recordSuccess();
    expect(events).toEqual([]);
  });
});
