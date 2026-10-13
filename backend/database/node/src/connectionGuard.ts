/**
 * Bounded failure guard for the pooled DB connection (authorizer throttling
 * remediation, Task 3).
 *
 * WHY THIS EXISTS
 * ---------------
 * The `wren-dev-authorizer` sits on the critical path for every authenticated
 * request, and its result is never cached (`authorizerResultTtlInSeconds: 0`).
 * During the Aug 19–20 incident a desynced DB password made every invocation
 * re-pay a full Secrets Manager fetch + TLS connect + failed handshake, and the
 * churn amplified concurrency pressure until the function throttled.
 *
 * This guard makes a *credential-class* failure fail fast for a very short,
 * hard-bounded window instead of hammering Secrets Manager/Postgres on every
 * invocation — WITHOUT letting a transient blip linger after recovery.
 *
 * SAFETY PROPERTIES (all mandatory — see the incident remediation plan)
 * ---------------------------------------------------------------------
 *  1. Failure-class distinction: only a credential/auth failure (Postgres
 *     `28P01`) may open the guard. Transient connect/network/timeout failures
 *     are NEVER cached — they must retry immediately on the next invocation.
 *  2. Very short, hard-capped open duration ({@link MAX_OPEN_MS}) so even a
 *     misclassification self-heals almost immediately.
 *  3. Immediate recovery: a successful connection closes the guard at once; the
 *     guard becomes probeable (half-open) the instant the window elapses and
 *     NEVER blocks indefinitely.
 *  4. Observability: opening and closing emit a structured log line (and an
 *     EMF-style metric) so operators can see the guard engage.
 *  5. It changes only HOW FAST we fail, never the HTTP status the caller maps
 *     (401 vs 500) — the caller keeps its own error semantics.
 *
 * The guard is deliberately process-local (one execution environment). It does
 * not coordinate across Lambda instances; each warm container protects itself.
 */

/** Postgres SQLSTATE for `invalid_password` — the credential-class signal. */
export const INVALID_PASSWORD_SQLSTATE = '28P01';

/** Default open window. Intentionally tiny so recovery is near-immediate. */
export const DEFAULT_OPEN_MS = 2_000;

/** Hard ceiling on the open window, enforced regardless of configuration. */
export const MAX_OPEN_MS = 5_000;

/** How the guard classifies a connection failure. */
export type FailureClass = 'credential' | 'transient';

/** Structured event emitted when the guard opens or closes. */
export interface GuardEvent {
  readonly event: 'db_connection_guard_open' | 'db_connection_guard_close';
  readonly failureClass?: FailureClass;
  /** Milliseconds the guard will stay open (open events only). */
  readonly openMs?: number;
}

/** Injectable clock + logger so tests are deterministic. */
export interface GuardDeps {
  readonly now?: () => number;
  readonly log?: (event: GuardEvent) => void;
}

/**
 * Classify a connection error. Only an explicit Postgres `28P01` is treated as
 * a (likely-persistent) credential failure. EVERYTHING ELSE — connect refused,
 * DNS, TLS, timeout, unknown — is `transient` and must retry, so a temporary
 * DB/network problem can never be cached into a lingering auth outage.
 */
export function classifyConnectionError(error: unknown): FailureClass {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code === INVALID_PASSWORD_SQLSTATE) {
    return 'credential';
  }
  return 'transient';
}

/** Default structured logger: one JSON line to stdout (CloudWatch-friendly). */
function defaultLog(event: GuardEvent): void {
  // EMF-style so a metric filter (Task 6) can alarm on open/close counts.
  console.log(JSON.stringify(event));
}

/**
 * A process-local circuit breaker with a hard-bounded open window that only
 * ever trips on credential-class failures.
 */
export class ConnectionGuard {
  private openUntil = 0;
  private lastFailureClass: FailureClass | undefined;
  private readonly now: () => number;
  private readonly log: (event: GuardEvent) => void;
  private readonly openMs: number;

  public constructor(openMs: number = DEFAULT_OPEN_MS, deps: GuardDeps = {}) {
    // Enforce the hard ceiling no matter what a caller/config passes in.
    this.openMs = Math.min(Math.max(1, Math.floor(openMs)), MAX_OPEN_MS);
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? defaultLog;
  }

  /**
   * Whether the guard is currently short-circuiting new connection attempts.
   * Becomes `false` (half-open — a probe is allowed) the instant the window
   * elapses; it never blocks indefinitely.
   */
  public isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  /**
   * Record a failed connection attempt. Opens the guard ONLY for a
   * credential-class failure; a transient failure leaves the guard closed so
   * the next invocation retries immediately.
   */
  public recordFailure(error: unknown): FailureClass {
    const failureClass = classifyConnectionError(error);
    if (failureClass !== 'credential') {
      // Never cache a transient failure. The guard stays closed.
      return failureClass;
    }
    const wasOpen = this.isOpen();
    this.openUntil = this.now() + this.openMs;
    this.lastFailureClass = failureClass;
    if (!wasOpen) {
      this.log({
        event: 'db_connection_guard_open',
        failureClass,
        openMs: this.openMs,
      });
    }
    return failureClass;
  }

  /**
   * Record a successful connection. Closes the guard immediately and clears any
   * remembered failure — recovery is instant.
   */
  public recordSuccess(): void {
    if (this.isOpen() || this.lastFailureClass !== undefined) {
      this.log({ event: 'db_connection_guard_close' });
    }
    this.openUntil = 0;
    this.lastFailureClass = undefined;
  }

  /** Reset state (tests / shutdown). Does not emit an event. */
  public reset(): void {
    this.openUntil = 0;
    this.lastFailureClass = undefined;
  }
}

/** Error thrown when the guard short-circuits a connection attempt. */
export class ConnectionGuardOpenError extends Error {
  public constructor() {
    super('Database connection temporarily unavailable (credential guard open).');
    this.name = 'ConnectionGuardOpenError';
  }
}
