/**
 * Cache capability & policy DECISION LAYER (prompt-cache plan Task 4, §7/§10/§11/§14/§15).
 *
 * This module is a pure, deterministic decision layer. It DOES NOT build requests,
 * DOES NOT add `cache_control` markers, DOES NOT change prompt text/ordering, and
 * DOES NOT change model output or error behavior. It only answers two questions
 * per invocation:
 *
 *   1. WHETHER explicit caching applies (mode × workload allowlist × model capability).
 *   2. WHERE the single approved checkpoint may go (which content classes may EVER
 *      carry a checkpoint — prohibited classes NEVER may).
 *
 * Task 5+ consumes these decisions to actually construct requests. Until then this
 * layer emits nothing and touches no live AWS resource.
 *
 * Default posture (plan §15): `mode=observe`, `ttl=5m`, no workloads enabled — so
 * `resolveCacheDecision` returns `applyExplicitCache: false` unless every gate is
 * explicitly satisfied.
 */

/** Caching mode (plan §15). `explicit` is the only mode that can ever cache. */
export type CacheMode = 'off' | 'observe' | 'explicit';

/** Cache write TTL (plan §7/§10). 5-minute first; 1-hour only when data justifies. */
export type CacheTtl = '5m' | '1h';

/** Logical workloads (plan §14 strategy matrix). Matches bedrockTelemetry `BedrockWorkload`. */
export type CacheWorkload =
  | 'ask_wren'
  | 'feedback_primary'
  | 'strength_fill'
  | 'quote_fill'
  | 'resolution_judge';

/** All recognized workloads, for iteration/validation. */
export const CACHE_WORKLOADS: readonly CacheWorkload[] = [
  'ask_wren',
  'feedback_primary',
  'strength_fill',
  'quote_fill',
  'resolution_judge',
];

/**
 * Model caching capability (plan §7). `undefined` capability => the model is
 * treated as uncached (unknown/non-Anthropic models).
 */
export interface ModelCacheCapability {
  /** Whether explicit caching is supported through InvokeModel. */
  supportsExplicitCache: boolean;
  /** Minimum cacheable prefix in tokens. */
  minCacheTokens: number;
  /** Maximum cache checkpoints per request. */
  maxCheckpoints: number;
  /** Supported cache TTLs. */
  ttls: readonly CacheTtl[];
  /** Fields that may carry a checkpoint. */
  cacheFields: readonly ('system' | 'messages' | 'tools')[];
}

/**
 * Normalize a Bedrock model id to a capability-registry key.
 *
 * Cross-region inference profiles (`us.`/`eu.`/`apac.`) and bare foundation-model
 * ids (`anthropic.*`) name the SAME underlying model, so they must map to one
 * capability entry. This strips a leading region prefix and lower-cases, mirroring
 * the region handling in `bedrockModelId.ts` without importing it (dependency-light).
 * A `:version` suffix (e.g. `...-v1:0`) is preserved as part of the key.
 */
export function normalizeModelKey(modelId: string): string {
  let id = (modelId ?? '').trim().toLowerCase();
  if (!id) return '';
  for (const prefix of ['us.', 'eu.', 'apac.']) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
      break;
    }
  }
  return id;
}

/**
 * Capability registry keyed by NORMALIZED model family/version (plan §7/§15).
 * Seeded for Claude Sonnet 4.6. Unknown/non-Anthropic keys are absent =>
 * {@link lookupModelCapability} returns undefined => treated as uncached.
 */
const CAPABILITY_REGISTRY: Readonly<Record<string, ModelCacheCapability>> = {
  'anthropic.claude-sonnet-4-6': {
    supportsExplicitCache: true,
    minCacheTokens: 1024,
    maxCheckpoints: 4,
    ttls: ['5m', '1h'],
    cacheFields: ['system', 'messages', 'tools'],
  },
};

/**
 * Look up caching capability for a model id (any region form / bare id).
 * Returns undefined for unknown or non-Anthropic models (treated as uncached).
 */
export function lookupModelCapability(
  modelId: string,
): ModelCacheCapability | undefined {
  return CAPABILITY_REGISTRY[normalizeModelKey(modelId)];
}

/** Approved content classes that MAY carry an explicit cache checkpoint (plan §10). */
export type ApprovedContentClass =
  | 'universal_system'
  | 'department_context'
  | 'document_type_config'
  | 'taxonomy'
  | 'approved_reference';

/** Prohibited content classes that must NEVER carry a cache checkpoint (plan §10). */
export type ProhibitedContentClass =
  | 'student_draft'
  | 'student_footnotes'
  | 'student_question'
  | 'conversation_history'
  | 'model_response';

/** Every content class the policy layer recognizes. */
export type ContentClass = ApprovedContentClass | ProhibitedContentClass;

const APPROVED_CONTENT_CLASSES: ReadonlySet<ApprovedContentClass> = new Set([
  'universal_system',
  'department_context',
  'document_type_config',
  'taxonomy',
  'approved_reference',
]);

const PROHIBITED_CONTENT_CLASSES: ReadonlySet<ProhibitedContentClass> = new Set([
  'student_draft',
  'student_footnotes',
  'student_question',
  'conversation_history',
  'model_response',
]);

/**
 * Whether a content class may EVER carry a cache checkpoint (plan §10).
 *
 * Prohibited classes (student content, conversation history, model responses)
 * ALWAYS return false. Any unrecognized class also returns false (fail-closed):
 * only explicitly approved trusted classes may ever be marked cacheable.
 */
export function mayContentClassBeCached(contentClass: string): boolean {
  if (PROHIBITED_CONTENT_CLASSES.has(contentClass as ProhibitedContentClass)) {
    return false;
  }
  return APPROVED_CONTENT_CLASSES.has(contentClass as ApprovedContentClass);
}

/**
 * Per-workload cache policy config (plan §14/§15). Resolvable from explicit
 * inputs/env with NO global state so it is fully testable.
 */
export interface CachePolicyConfig {
  mode: CacheMode;
  ttl: CacheTtl;
  /** Workloads for which explicit caching is enabled. */
  enabledWorkloads: ReadonlySet<CacheWorkload>;
}

/**
 * Initial config per plan §15: `mode=observe`, `ttl=5m`, no workloads enabled.
 * Returned as a fresh object so callers cannot mutate shared state.
 */
export function defaultCachePolicyConfig(): CachePolicyConfig {
  return { mode: 'observe', ttl: '5m', enabledWorkloads: new Set() };
}

function parseMode(value: string | undefined): CacheMode | undefined {
  const v = value?.trim().toLowerCase();
  if (v === 'off' || v === 'observe' || v === 'explicit') return v;
  return undefined;
}

function parseTtl(value: string | undefined): CacheTtl | undefined {
  const v = value?.trim().toLowerCase();
  if (v === '5m' || v === '1h') return v;
  return undefined;
}

/**
 * Parse a comma/space-separated workload list (env or explicit string) into a
 * set of recognized workloads. Unrecognized tokens are ignored (fail-closed:
 * a typo never enables an unintended workload). Accepts both `ask_wren` and the
 * plan's hyphenated `ask-wren` spelling.
 */
export function parseEnabledWorkloads(
  value: string | undefined,
): Set<CacheWorkload> {
  const result = new Set<CacheWorkload>();
  if (!value) return result;
  for (const raw of value.split(/[,\s]+/)) {
    const token = raw.trim().toLowerCase().replace(/-/g, '_');
    if ((CACHE_WORKLOADS as readonly string[]).includes(token)) {
      result.add(token as CacheWorkload);
    }
  }
  return result;
}

/**
 * Resolve the effective cache policy config from explicit values first, then env
 * (`CACHE_MODE`, `CACHE_TTL`, `CACHE_ENABLED_WORKLOADS`), falling back to the
 * plan §15 defaults. Env is injectable (no globals) so tests need no process.env.
 */
export function resolveCachePolicyConfig(
  overrides: Partial<{
    mode: CacheMode;
    ttl: CacheTtl;
    enabledWorkloads: Iterable<CacheWorkload>;
  }> = {},
  env: Record<string, string | undefined> = process.env,
): CachePolicyConfig {
  const mode = overrides.mode ?? parseMode(env.CACHE_MODE) ?? 'observe';
  const ttl = overrides.ttl ?? parseTtl(env.CACHE_TTL) ?? '5m';
  const enabledWorkloads =
    overrides.enabledWorkloads !== undefined
      ? new Set(overrides.enabledWorkloads)
      : parseEnabledWorkloads(env.CACHE_ENABLED_WORKLOADS);
  return { mode, ttl, enabledWorkloads };
}

/** Reasons a cache decision resolved the way it did (for telemetry/debugging). */
export type CacheDecisionReason =
  | 'mode_off'
  | 'mode_observe'
  | 'workload_not_enabled'
  | 'unsupported_model'
  | 'explicit_enabled';

/** Structured, deterministic output of {@link resolveCacheDecision}. */
export interface CacheDecision {
  /** True ONLY when explicit caching should be applied for this invocation. */
  applyExplicitCache: boolean;
  /** TTL to use when caching applies; omitted when it does not. */
  ttl?: CacheTtl;
  /** Why the decision resolved as it did. */
  reason: CacheDecisionReason;
}

/** Inputs to {@link resolveCacheDecision}. */
export interface CacheDecisionInput {
  mode: CacheMode;
  ttl: CacheTtl;
  workload: CacheWorkload;
  modelId: string;
  /** Workloads for which explicit caching is enabled. */
  enabledWorkloads: ReadonlySet<CacheWorkload> | Iterable<CacheWorkload>;
}

/**
 * Decide whether explicit caching applies to a single invocation (plan §14/§15).
 *
 * `applyExplicitCache` is true ONLY when ALL of these hold:
 *   - `mode === 'explicit'`, AND
 *   - `workload` is in `enabledWorkloads`, AND
 *   - the model (normalized) has a capability with `supportsExplicitCache`.
 *
 * In `off` and `observe` modes it is ALWAYS false. An unknown/non-Anthropic model
 * yields false with reason `unsupported_model`. This is a decision only — no
 * request is built and no marker is emitted here.
 */
export function resolveCacheDecision(input: CacheDecisionInput): CacheDecision {
  const { mode, ttl, workload, modelId } = input;

  if (mode === 'off') return { applyExplicitCache: false, reason: 'mode_off' };
  if (mode === 'observe') {
    return { applyExplicitCache: false, reason: 'mode_observe' };
  }

  // mode === 'explicit' from here.
  const enabled =
    input.enabledWorkloads instanceof Set
      ? input.enabledWorkloads
      : new Set(input.enabledWorkloads);
  if (!enabled.has(workload)) {
    return { applyExplicitCache: false, reason: 'workload_not_enabled' };
  }

  const capability = lookupModelCapability(modelId);
  if (!capability || !capability.supportsExplicitCache) {
    return { applyExplicitCache: false, reason: 'unsupported_model' };
  }

  return { applyExplicitCache: true, ttl, reason: 'explicit_enabled' };
}

/**
 * Classify whether an error is a CLEAR cache syntax/capability rejection that
 * should trigger a SINGLE uncached retry (plan §15; consumed by Task 5+).
 *
 * This is intentionally conservative: it recognizes only Bedrock/Anthropic
 * validation errors whose message clearly references cache_control / prompt
 * caching syntax or capability. Arbitrary failures (throttling, timeouts,
 * access denied, model errors, generic validation errors) MUST NOT be classified
 * as retryable — they keep the current behavior with no extra inference.
 */
export function isCacheValidationError(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  // Extract a name + message defensively from Error-like or plain objects.
  let name = '';
  let message = '';
  if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    name = typeof e.name === 'string' ? e.name : '';
    if (typeof e.message === 'string') message = e.message;
    // Some AWS SDK errors carry the code on `__type` / `Code`.
    if (!name && typeof e.__type === 'string') name = e.__type;
    if (!name && typeof e.Code === 'string') name = e.Code;
  } else {
    return false;
  }

  const haystack = `${name}\n${message}`.toLowerCase();

  // Must look like a validation/bad-request class error...
  const isValidationClass =
    haystack.includes('validationexception') ||
    haystack.includes('validation error') ||
    haystack.includes('invalid') ||
    haystack.includes('malformed') ||
    haystack.includes('unsupported') ||
    haystack.includes('not supported');
  if (!isValidationClass) return false;

  // ...AND clearly reference cache syntax/capability specifically.
  const mentionsCache =
    haystack.includes('cache_control') ||
    haystack.includes('cachecontrol') ||
    haystack.includes('cache control') ||
    haystack.includes('cache checkpoint') ||
    haystack.includes('prompt cache') ||
    haystack.includes('prompt caching') ||
    haystack.includes('caching');
  return mentionsCache;
}
