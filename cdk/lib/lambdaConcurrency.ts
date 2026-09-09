/**
 * Reserved-concurrency policy for the Compute Lambdas.
 *
 * Incident remediation: `wren-dev-authorizer` (the Cognito JWT authorizer on
 * the critical path for every authenticated request) was throttled repeatedly
 * because the account concurrent-executions quota (`L-B99A9384`) was only 10
 * and 17 functions shared that pool with NO reserved concurrency. Long-running
 * functions (feedback-engine at a 15-minute timeout, document at 3 minutes)
 * could hold the whole pool and starve auth.
 *
 * This module defines a small, environment-tunable allocation and a
 * synth-time invariant check so a mis-sized allocation fails fast at `cdk synth`
 * rather than at deploy or — worse — silently in production.
 *
 * See `docs/authorizer-throttling-remediation.md`.
 *
 * IMPORTANT: reserving concurrency requires the account quota to be raised
 * FIRST (Task 1). Reserving against a limit of 10 fails CloudFormation because
 * AWS requires at least 10 unreserved concurrency to remain in the account.
 */

/** Functions that receive an explicit reserved-concurrency setting. */
export type ConcurrencyManagedFunction =
  | "authorizer"
  | "appsyncAuthorizer"
  | "feedbackEngine"
  | "document";

/**
 * Reserved-concurrency configuration.
 *
 * - `accountLimit` mirrors the account concurrent-executions quota
 *   (`L-B99A9384`). It is NOT enforced by CDK on the account; it is the value
 *   the invariant check validates the reserved totals against, so a deploy that
 *   would exceed the real limit is caught at synth.
 * - Each per-function value is a hard reserved-concurrency setting. For the
 *   authorizers it acts as a guaranteed FLOOR (capacity carved out for auth);
 *   for feedback-engine/document it acts as a CAP (bounding how much of the
 *   pool a burst can consume).
 */
export interface LambdaConcurrencyConfig {
  /** Account concurrent-executions quota the reserved totals must fit under. */
  readonly accountLimit: number;
  /** Reserved concurrency for the REST Cognito authorizer (critical path). */
  readonly authorizer: number;
  /** Reserved concurrency for the AppSync realtime authorizer. */
  readonly appsyncAuthorizer: number;
  /** Reserved cap for the feedback engine (aligns with SQS maxConcurrency). */
  readonly feedbackEngine: number;
  /**
   * Reserved cap for the document service. NOTE: `DocumentFn` is dual-purpose —
   * it is both the SQS OCR ingest worker (maxConcurrency 5) AND the synchronous
   * handler for the document/draft REST API. Reserved concurrency caps TOTAL
   * concurrent executions across both paths, so this value MUST exceed the SQS
   * ingest cap to leave headroom for live API traffic; otherwise a burst of OCR
   * jobs would throttle authenticated document API calls (429). Default 10 =
   * 5 ingest + 5 sync-API headroom.
   */
  readonly document: number;
}

/**
 * AWS requires at least this much UNRESERVED concurrency to remain in the
 * account after all reservations. Synth fails if a config would violate it.
 */
export const MIN_UNRESERVED_CONCURRENCY = 10;

/**
 * Default allocation (dev). Assumes the account quota has been raised to >= 100
 * (Task 1). These values are HYPOTHESIZED as sufficient and should be validated
 * under load (Task 7); override per environment via CDK context.
 */
export const DEFAULT_LAMBDA_CONCURRENCY: LambdaConcurrencyConfig = {
  accountLimit: 200,
  authorizer: 15,
  appsyncAuthorizer: 5,
  feedbackEngine: 10,
  // 5 for the SQS OCR ingest worker (its maxConcurrency) + 5 headroom for the
  // synchronous document/draft REST API the same function also serves, so OCR
  // bursts cannot throttle live API calls.
  document: 10,
};

/** Sum of all reserved concurrency across the managed functions. */
export function totalReservedConcurrency(config: LambdaConcurrencyConfig): number {
  return (
    config.authorizer + config.appsyncAuthorizer + config.feedbackEngine + config.document
  );
}

/**
 * Validate a reserved-concurrency config, throwing at synth on any violation:
 *
 *  - every value must be a positive integer;
 *  - `accountLimit` must be large enough that raising the quota actually
 *    happened (>= MIN_UNRESERVED_CONCURRENCY makes no sense on its own, so we
 *    also require it to exceed the reserved total by the unreserved floor);
 *  - reserved totals must leave at least {@link MIN_UNRESERVED_CONCURRENCY}
 *    unreserved so the remaining functions (and Lambda itself) keep capacity.
 *
 * @returns the validated config (for fluent use).
 */
export function assertConcurrencyInvariants(
  config: LambdaConcurrencyConfig,
): LambdaConcurrencyConfig {
  const entries: ReadonlyArray<[string, number]> = [
    ["accountLimit", config.accountLimit],
    ["authorizer", config.authorizer],
    ["appsyncAuthorizer", config.appsyncAuthorizer],
    ["feedbackEngine", config.feedbackEngine],
    ["document", config.document],
  ];
  for (const [name, value] of entries) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `lambdaConcurrency.${name} must be a positive integer (got ${String(value)}).`,
      );
    }
  }

  const reserved = totalReservedConcurrency(config);
  const unreserved = config.accountLimit - reserved;
  if (unreserved < MIN_UNRESERVED_CONCURRENCY) {
    throw new Error(
      `Reserved concurrency (${reserved}) leaves only ${unreserved} unreserved of ` +
        `accountLimit ${config.accountLimit}; AWS requires at least ` +
        `${MIN_UNRESERVED_CONCURRENCY} unreserved. Raise the account quota ` +
        `(L-B99A9384) or lower the reservations. See ` +
        `docs/authorizer-throttling-remediation.md.`,
    );
  }

  return config;
}

/**
 * Resolve the reserved-concurrency config from optional CDK context overrides,
 * validating invariants. Context keys (all optional, integer strings):
 *   - `lambdaAccountLimit`
 *   - `authorizerReservedConcurrency`
 *   - `appsyncAuthorizerReservedConcurrency`
 *   - `feedbackEngineReservedConcurrency`
 *   - `documentReservedConcurrency`
 */
export function resolveLambdaConcurrency(
  read: (key: string) => string | undefined,
): LambdaConcurrencyConfig {
  const readInt = (key: string, fallback: number): number => {
    const raw = read(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${key} must be an integer (got '${raw}').`);
    }
    return parsed;
  };

  const config: LambdaConcurrencyConfig = {
    accountLimit: readInt("lambdaAccountLimit", DEFAULT_LAMBDA_CONCURRENCY.accountLimit),
    authorizer: readInt(
      "authorizerReservedConcurrency",
      DEFAULT_LAMBDA_CONCURRENCY.authorizer,
    ),
    appsyncAuthorizer: readInt(
      "appsyncAuthorizerReservedConcurrency",
      DEFAULT_LAMBDA_CONCURRENCY.appsyncAuthorizer,
    ),
    feedbackEngine: readInt(
      "feedbackEngineReservedConcurrency",
      DEFAULT_LAMBDA_CONCURRENCY.feedbackEngine,
    ),
    document: readInt("documentReservedConcurrency", DEFAULT_LAMBDA_CONCURRENCY.document),
  };

  return assertConcurrencyInvariants(config);
}
