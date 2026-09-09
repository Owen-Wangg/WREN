import {
  assertConcurrencyInvariants,
  DEFAULT_LAMBDA_CONCURRENCY,
  MIN_UNRESERVED_CONCURRENCY,
  resolveLambdaConcurrency,
  totalReservedConcurrency,
  type LambdaConcurrencyConfig,
} from "../lib/lambdaConcurrency.js";

/**
 * Reserved-concurrency policy (authorizer throttling remediation, Task 2).
 *
 * These tests prove the synth-time invariants that keep a mis-sized allocation
 * from ever reaching deploy: reserved totals must leave >= 10 unreserved and
 * fit under the account limit, and every value must be a positive integer.
 */

function cfg(overrides: Partial<LambdaConcurrencyConfig> = {}): LambdaConcurrencyConfig {
  return { ...DEFAULT_LAMBDA_CONCURRENCY, ...overrides };
}

describe("lambdaConcurrency — invariants", () => {
  it("accepts the default allocation and leaves >= 10 unreserved", () => {
    const config = assertConcurrencyInvariants(DEFAULT_LAMBDA_CONCURRENCY);
    const unreserved = config.accountLimit - totalReservedConcurrency(config);
    expect(unreserved).toBeGreaterThanOrEqual(MIN_UNRESERVED_CONCURRENCY);
  });

  it("rejects an allocation that leaves fewer than 10 unreserved", () => {
    // 15 + 5 + 10 + 5 = 35 reserved; limit 40 leaves only 5 unreserved.
    expect(() => assertConcurrencyInvariants(cfg({ accountLimit: 40 }))).toThrow(
      /at least 10 unreserved/,
    );
  });

  it("rejects the pathological pre-remediation limit of 10", () => {
    expect(() => assertConcurrencyInvariants(cfg({ accountLimit: 10 }))).toThrow(
      /unreserved/,
    );
  });

  it("rejects non-positive or non-integer values", () => {
    expect(() => assertConcurrencyInvariants(cfg({ authorizer: 0 }))).toThrow(
      /positive integer/,
    );
    expect(() => assertConcurrencyInvariants(cfg({ document: -1 }))).toThrow(
      /positive integer/,
    );
    expect(() => assertConcurrencyInvariants(cfg({ feedbackEngine: 2.5 }))).toThrow(
      /positive integer/,
    );
  });

  it("caps feedback-engine at its SQS maxConcurrency (queue-only function)", () => {
    // feedback-engine is SQS-only, so its reserved cap should equal its SQS
    // maxConcurrency (10) — no wasted headroom the queue can never use.
    expect(DEFAULT_LAMBDA_CONCURRENCY.feedbackEngine).toBeLessThanOrEqual(10);
  });

  it("gives document reserved concurrency headroom ABOVE its SQS ingest cap", () => {
    // DocumentFn is dual-purpose: SQS OCR worker (maxConcurrency 5) AND the
    // synchronous document/draft REST API. The reservation must EXCEED the SQS
    // cap so an OCR burst cannot consume the whole reservation and throttle live
    // API calls. (5 ingest + sync-API headroom.)
    const SQS_INGEST_MAX_CONCURRENCY = 5;
    expect(DEFAULT_LAMBDA_CONCURRENCY.document).toBeGreaterThan(SQS_INGEST_MAX_CONCURRENCY);
  });
});

describe("lambdaConcurrency — context resolution", () => {
  const read = (values: Record<string, string>) => (key: string): string | undefined =>
    values[key];

  it("defaults to DEFAULT_LAMBDA_CONCURRENCY when no context is provided", () => {
    expect(resolveLambdaConcurrency(read({}))).toEqual(DEFAULT_LAMBDA_CONCURRENCY);
  });

  it("applies integer context overrides", () => {
    const config = resolveLambdaConcurrency(
      read({
        lambdaAccountLimit: "500",
        authorizerReservedConcurrency: "40",
      }),
    );
    expect(config.accountLimit).toBe(500);
    expect(config.authorizer).toBe(40);
  });

  it("rejects a non-integer override at synth", () => {
    expect(() =>
      resolveLambdaConcurrency(read({ authorizerReservedConcurrency: "ten" })),
    ).toThrow(/must be an integer/);
  });

  it("fails synth when overrides violate the unreserved floor", () => {
    expect(() =>
      resolveLambdaConcurrency(read({ lambdaAccountLimit: "30" })),
    ).toThrow(/unreserved/);
  });
});
