/**
 * Bedrock invocation telemetry — OBSERVE MODE (prompt-cache plan Task 3, §8/§9/§16).
 *
 * This module is pure instrumentation. It NEVER adds cache_control markers,
 * NEVER changes prompt text/ordering, and NEVER changes model output or error
 * behavior. It only:
 *   1. Normalizes the Anthropic `usage` block from an InvokeModel response into a
 *      typed {@link InvocationUsage} (missing/partial usage tolerated → 0).
 *   2. Estimates per-request cost against a versioned price registry (§8/§9).
 *      Unknown models yield undefined estimates (cost fields omitted, no crash).
 *   3. Emits a CloudWatch Embedded Metric Format (EMF) event via `console.log`
 *      (Lambda scrapes stdout) plus a structured, privacy-safe log line.
 *
 * PRIVACY (plan §16): never log prompt text; never use user / document / draft /
 * department / job identifiers as metric dimensions or metric fields. Only
 * `workload` and `modelId` are permitted dimensions. A Bedrock requestId may
 * appear in the structured log line but never as a dimension.
 */

/** EMF namespace for all WREN Bedrock metrics. */
export const EMF_NAMESPACE = 'WREN/Bedrock';

/** Logical workloads (matches the plan's per-workload strategy matrix, §14). */
export type BedrockWorkload =
  | 'ask_wren'
  | 'feedback_primary'
  | 'strength_fill'
  | 'quote_fill'
  | 'resolution_judge';

/**
 * Normalized token usage plus invocation metadata. Token counts default to 0
 * when the model omits them (older/other models, or no caching activity).
 */
export interface InvocationUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  modelId: string;
  workload: BedrockWorkload;
  latencyMs: number;
  stopReason: string;
  success: boolean;
  fallbackReason?: string;
}

/** Per-1M-token rates. All optional so an unknown model omits cost entirely. */
export interface ModelRates {
  /** Standard (uncached) input tokens, per 1M. */
  inputPerMillion: number;
  /** 5-minute cache write, per 1M. */
  cacheWrite5mPerMillion: number;
  /** 1-hour cache write, per 1M. */
  cacheWrite1hPerMillion: number;
  /** Cache read, per 1M. */
  cacheReadPerMillion: number;
  /** Output tokens, per 1M. */
  outputPerMillion: number;
}

/** A single versioned price entry keyed by model id + effective date (§8). */
export interface PriceRegistryEntry {
  modelId: string;
  /** ISO date (YYYY-MM-DD) the rates take effect. */
  effectiveDate: string;
  rates: ModelRates;
}

/**
 * Versioned price registry (plan §8). Do NOT hardcode rates in invocation code —
 * always resolve through {@link resolveModelRates}. Seeded for Claude Sonnet 4.6.
 */
export const PRICE_REGISTRY: readonly PriceRegistryEntry[] = [
  {
    modelId: 'us.anthropic.claude-sonnet-4-6',
    effectiveDate: '2026-09-03',
    rates: {
      inputPerMillion: 3.0,
      cacheWrite5mPerMillion: 3.75,
      cacheWrite1hPerMillion: 6.0,
      cacheReadPerMillion: 0.3,
      outputPerMillion: 15.0,
    },
  },
];

/**
 * Resolve the most recent rates for `modelId` effective on/before `asOf`.
 * Returns undefined for unknown models so callers omit cost fields (no crash).
 */
export function resolveModelRates(
  modelId: string,
  asOf: Date = new Date(),
): ModelRates | undefined {
  const asOfIso = asOf.toISOString().slice(0, 10);
  let best: PriceRegistryEntry | undefined;
  for (const entry of PRICE_REGISTRY) {
    if (entry.modelId !== modelId) continue;
    if (entry.effectiveDate > asOfIso) continue;
    if (!best || entry.effectiveDate > best.effectiveDate) best = entry;
  }
  return best?.rates;
}

/** Coerce an arbitrary value to a finite, non-negative integer token count. */
function toTokenCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Defensively read the Anthropic `usage` block from a decoded InvokeModel
 * response. Tolerates a missing/partial/non-object `usage` (older or non-Anthropic
 * models) by defaulting each token field to 0. Never throws.
 */
export function parseInvocationUsage(decodedResponse: unknown): {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
} {
  const usage =
    decodedResponse &&
    typeof decodedResponse === 'object' &&
    'usage' in decodedResponse &&
    (decodedResponse as { usage: unknown }).usage &&
    typeof (decodedResponse as { usage: unknown }).usage === 'object'
      ? ((decodedResponse as { usage: Record<string, unknown> }).usage)
      : {};
  return {
    input_tokens: toTokenCount(usage.input_tokens),
    output_tokens: toTokenCount(usage.output_tokens),
    cache_creation_input_tokens: toTokenCount(usage.cache_creation_input_tokens),
    cache_read_input_tokens: toTokenCount(usage.cache_read_input_tokens),
  };
}

/** Estimated per-request cost breakdown (USD). Undefined when rates unknown. */
export interface CostEstimate {
  /** Actual billed cost given the real token/cache split. */
  actualUsd: number;
  /** What the same tokens would cost with no caching (all input at base rate). */
  uncachedEquivUsd: number;
  /** uncachedEquiv - actual (positive = savings from caching). */
  savingsUsd: number;
}

/** Which cache-write TTL a request used (affects the write rate). */
export type CacheTtl = '5m' | '1h';

/**
 * Compute the per-request cost per plan §9. Returns undefined when the model has
 * no rates in the registry (so cost fields are omitted downstream, never faked).
 *
 * In observe mode cache_creation/read are 0, so actual == uncachedEquiv and
 * savings == 0 — this is the intended uncached baseline.
 */
export function estimateCost(
  usage: Pick<
    InvocationUsage,
    | 'input_tokens'
    | 'output_tokens'
    | 'cache_creation_input_tokens'
    | 'cache_read_input_tokens'
  >,
  rates: ModelRates | undefined,
  ttl: CacheTtl = '5m',
): CostEstimate | undefined {
  if (!rates) return undefined;
  const writeRate =
    ttl === '1h' ? rates.cacheWrite1hPerMillion : rates.cacheWrite5mPerMillion;

  const actualUsd =
    (usage.input_tokens * rates.inputPerMillion +
      usage.cache_creation_input_tokens * writeRate +
      usage.cache_read_input_tokens * rates.cacheReadPerMillion +
      usage.output_tokens * rates.outputPerMillion) /
    1_000_000;

  const uncachedEquivUsd =
    ((usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens) *
      rates.inputPerMillion +
      usage.output_tokens * rates.outputPerMillion) /
    1_000_000;

  return {
    actualUsd,
    uncachedEquivUsd,
    savingsUsd: uncachedEquivUsd - actualUsd,
  };
}

/** The JSON object shape written to stdout as a CloudWatch EMF event. */
export interface EmfEvent {
  _aws: {
    Timestamp: number;
    CloudWatchMetrics: Array<{
      Namespace: string;
      Dimensions: string[][];
      Metrics: Array<{ Name: string; Unit: string }>;
    }>;
  };
  // Dimension values (ONLY workload + modelId per §16).
  workload: string;
  modelId: string;
  // Metric values.
  Invocations: number;
  InputTokens: number;
  OutputTokens: number;
  CacheWriteInputTokens: number;
  CacheReadInputTokens: number;
  CacheEligibleInvocations: number;
  CacheFallbacks: number;
  InvocationLatency: number;
  EstimatedCostUsd?: number;
  EstimatedSavingsUsd?: number;
}

/** The privacy-safe structured log line emitted alongside the EMF event. */
export interface TelemetryLogLine {
  event: 'bedrock_invocation';
  workload: string;
  modelId: string;
  success: boolean;
  stopReason: string;
  latencyMs: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cacheEligible: boolean;
  fallbackReason?: string;
  /** Bedrock request id is allowed in logs only, never as a metric dimension. */
  requestId?: string;
  estimatedCostUsd?: number;
  estimatedSavingsUsd?: number;
}

/** Options controlling how a telemetry event is emitted. */
export interface EmitOptions {
  /** Whether this invocation was eligible for caching (observe mode: usually false). */
  cacheEligible?: boolean;
  /** Whether a cache fallback occurred (retry uncached). */
  cacheFallback?: boolean;
  /** Cache write TTL used when computing cost (default 5m). */
  ttl?: CacheTtl;
  /** Bedrock request id (log line only, never a dimension). */
  requestId?: string;
  /** Timestamp override (ms) — for deterministic tests. */
  timestampMs?: number;
  /** Sink override — defaults to console.log so Lambda scrapes stdout. */
  log?: (line: string) => void;
}

/**
 * Build the EMF event object for an invocation. Kept separate from
 * {@link emitTelemetry} so tests can assert its exact shape without capturing
 * stdout. Dimensions are ALWAYS only [workload, modelId].
 */
export function buildEmfEvent(
  usage: InvocationUsage,
  options: EmitOptions = {},
): EmfEvent {
  const rates = resolveModelRates(usage.modelId);
  const cost = estimateCost(usage, rates, options.ttl ?? '5m');

  const metrics: Array<{ Name: string; Unit: string }> = [
    { Name: 'Invocations', Unit: 'Count' },
    { Name: 'InputTokens', Unit: 'Count' },
    { Name: 'OutputTokens', Unit: 'Count' },
    { Name: 'CacheWriteInputTokens', Unit: 'Count' },
    { Name: 'CacheReadInputTokens', Unit: 'Count' },
    { Name: 'CacheEligibleInvocations', Unit: 'Count' },
    { Name: 'CacheFallbacks', Unit: 'Count' },
    { Name: 'InvocationLatency', Unit: 'Milliseconds' },
  ];
  if (cost) {
    metrics.push({ Name: 'EstimatedCostUsd', Unit: 'None' });
    metrics.push({ Name: 'EstimatedSavingsUsd', Unit: 'None' });
  }

  const event: EmfEvent = {
    _aws: {
      Timestamp: options.timestampMs ?? Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: EMF_NAMESPACE,
          // ONLY workload + modelId are permitted dimensions (§16).
          Dimensions: [['workload', 'modelId']],
          Metrics: metrics,
        },
      ],
    },
    workload: usage.workload,
    modelId: usage.modelId,
    Invocations: 1,
    InputTokens: usage.input_tokens,
    OutputTokens: usage.output_tokens,
    CacheWriteInputTokens: usage.cache_creation_input_tokens,
    CacheReadInputTokens: usage.cache_read_input_tokens,
    CacheEligibleInvocations: options.cacheEligible ? 1 : 0,
    CacheFallbacks: options.cacheFallback ? 1 : 0,
    InvocationLatency: usage.latencyMs,
  };
  if (cost) {
    event.EstimatedCostUsd = cost.actualUsd;
    event.EstimatedSavingsUsd = cost.savingsUsd;
  }
  return event;
}

/** Build the privacy-safe structured log line for an invocation. */
export function buildLogLine(
  usage: InvocationUsage,
  options: EmitOptions = {},
): TelemetryLogLine {
  const rates = resolveModelRates(usage.modelId);
  const cost = estimateCost(usage, rates, options.ttl ?? '5m');
  const line: TelemetryLogLine = {
    event: 'bedrock_invocation',
    workload: usage.workload,
    modelId: usage.modelId,
    success: usage.success,
    stopReason: usage.stopReason,
    latencyMs: usage.latencyMs,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    cacheEligible: Boolean(options.cacheEligible),
  };
  if (usage.fallbackReason) line.fallbackReason = usage.fallbackReason;
  if (options.requestId) line.requestId = options.requestId;
  if (cost) {
    line.estimatedCostUsd = cost.actualUsd;
    line.estimatedSavingsUsd = cost.savingsUsd;
  }
  return line;
}

/**
 * Emit telemetry for a completed (or failed) invocation: one EMF JSON line and
 * one structured log line, both to stdout. Never throws — telemetry failures must
 * not affect the caller's return value or error behavior.
 */
export function emitTelemetry(
  usage: InvocationUsage,
  options: EmitOptions = {},
): void {
  const sink = options.log ?? ((line: string) => console.log(line));
  try {
    sink(JSON.stringify(buildEmfEvent(usage, options)));
    sink(JSON.stringify(buildLogLine(usage, options)));
  } catch {
    // Swallow — observe-mode telemetry must never break the request path.
  }
}
