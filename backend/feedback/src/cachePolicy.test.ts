/**
 * Unit tests for the cache capability & policy DECISION LAYER (prompt-cache Task 4).
 *
 * No live AWS. Covers: capability lookup (supported / unknown / cross-region /
 * bare ids), content-class approval (prohibited never cacheable), the full
 * decision matrix (mode × workload-enabled × supported/unknown model), config
 * resolution, and the cache-validation-error classifier (accepts clear cache
 * rejections, rejects arbitrary errors).
 */
import {
  CACHE_WORKLOADS,
  CacheWorkload,
  defaultCachePolicyConfig,
  isCacheValidationError,
  lookupModelCapability,
  mayContentClassBeCached,
  normalizeModelKey,
  parseEnabledWorkloads,
  resolveCacheDecision,
  resolveCachePolicyConfig,
} from './cachePolicy';

const SUPPORTED_CRIS = 'us.anthropic.claude-sonnet-4-6';
const SUPPORTED_BARE = 'anthropic.claude-sonnet-4-6';
const SUPPORTED_EU = 'eu.anthropic.claude-sonnet-4-6';
const UNKNOWN_MODEL = 'meta.llama3-70b-instruct-v1:0';
const NON_ANTHROPIC = 'us.amazon.nova-pro-v1:0';

describe('normalizeModelKey', () => {
  it('strips region prefixes so cross-region + bare ids collapse to one key', () => {
    expect(normalizeModelKey(SUPPORTED_CRIS)).toBe('anthropic.claude-sonnet-4-6');
    expect(normalizeModelKey(SUPPORTED_BARE)).toBe('anthropic.claude-sonnet-4-6');
    expect(normalizeModelKey(SUPPORTED_EU)).toBe('anthropic.claude-sonnet-4-6');
    expect(normalizeModelKey('APAC.Anthropic.Claude-Sonnet-4-6')).toBe(
      'anthropic.claude-sonnet-4-6',
    );
  });

  it('handles empty/whitespace input', () => {
    expect(normalizeModelKey('')).toBe('');
    expect(normalizeModelKey('   ')).toBe('');
  });
});

describe('lookupModelCapability', () => {
  it('returns the seeded capability for the supported model (all region forms)', () => {
    for (const id of [SUPPORTED_CRIS, SUPPORTED_BARE, SUPPORTED_EU]) {
      const cap = lookupModelCapability(id);
      expect(cap).toBeDefined();
      expect(cap).toEqual({
        supportsExplicitCache: true,
        minCacheTokens: 1024,
        maxCheckpoints: 4,
        ttls: ['5m', '1h'],
        cacheFields: ['system', 'messages', 'tools'],
      });
    }
  });

  it('returns undefined for unknown / non-Anthropic models (treated as uncached)', () => {
    expect(lookupModelCapability(UNKNOWN_MODEL)).toBeUndefined();
    expect(lookupModelCapability(NON_ANTHROPIC)).toBeUndefined();
    expect(lookupModelCapability('')).toBeUndefined();
  });
});

describe('mayContentClassBeCached', () => {
  const approved = [
    'universal_system',
    'department_context',
    'document_type_config',
    'taxonomy',
    'approved_reference',
  ];
  const prohibited = [
    'student_draft',
    'student_footnotes',
    'student_question',
    'conversation_history',
    'model_response',
  ];

  it.each(approved)('approved class %s may be cached', (cls) => {
    expect(mayContentClassBeCached(cls)).toBe(true);
  });

  it.each(prohibited)('prohibited class %s may NEVER be cached', (cls) => {
    expect(mayContentClassBeCached(cls)).toBe(false);
  });

  it('unrecognized class is fail-closed (false)', () => {
    expect(mayContentClassBeCached('something_else')).toBe(false);
    expect(mayContentClassBeCached('')).toBe(false);
  });
});

describe('config resolution', () => {
  it('defaults to observe / 5m / no workloads (plan §15)', () => {
    const cfg = defaultCachePolicyConfig();
    expect(cfg.mode).toBe('observe');
    expect(cfg.ttl).toBe('5m');
    expect(cfg.enabledWorkloads.size).toBe(0);
  });

  it('resolves from an injected env with no globals', () => {
    const cfg = resolveCachePolicyConfig(
      {},
      {
        CACHE_MODE: 'explicit',
        CACHE_TTL: '1h',
        CACHE_ENABLED_WORKLOADS: 'ask-wren, feedback_primary',
      },
    );
    expect(cfg.mode).toBe('explicit');
    expect(cfg.ttl).toBe('1h');
    expect([...cfg.enabledWorkloads].sort()).toEqual([
      'ask_wren',
      'feedback_primary',
    ]);
  });

  it('explicit overrides beat env; falls back to defaults for absent/garbage env', () => {
    const cfg = resolveCachePolicyConfig(
      { mode: 'observe' },
      { CACHE_MODE: 'explicit', CACHE_TTL: 'nonsense' },
    );
    expect(cfg.mode).toBe('observe');
    expect(cfg.ttl).toBe('5m');
  });

  it('parseEnabledWorkloads ignores unrecognized tokens (fail-closed)', () => {
    const set = parseEnabledWorkloads('ask_wren, bogus, resolution-judge');
    expect([...set].sort()).toEqual(['ask_wren', 'resolution_judge']);
  });
});

describe('resolveCacheDecision matrix', () => {
  const enabledAll = new Set<CacheWorkload>(CACHE_WORKLOADS);
  const enabledNone = new Set<CacheWorkload>();

  it('off mode is always false regardless of workload/model', () => {
    for (const workload of CACHE_WORKLOADS) {
      for (const model of [SUPPORTED_CRIS, UNKNOWN_MODEL]) {
        const d = resolveCacheDecision({
          mode: 'off',
          ttl: '5m',
          workload,
          modelId: model,
          enabledWorkloads: enabledAll,
        });
        expect(d.applyExplicitCache).toBe(false);
        expect(d.reason).toBe('mode_off');
        expect(d.ttl).toBeUndefined();
      }
    }
  });

  it('observe mode is always false regardless of workload/model', () => {
    for (const workload of CACHE_WORKLOADS) {
      for (const model of [SUPPORTED_CRIS, UNKNOWN_MODEL]) {
        const d = resolveCacheDecision({
          mode: 'observe',
          ttl: '5m',
          workload,
          modelId: model,
          enabledWorkloads: enabledAll,
        });
        expect(d.applyExplicitCache).toBe(false);
        expect(d.reason).toBe('mode_observe');
      }
    }
  });

  it('explicit + enabled + supported model => true with ttl', () => {
    for (const workload of CACHE_WORKLOADS) {
      const d = resolveCacheDecision({
        mode: 'explicit',
        ttl: '1h',
        workload,
        modelId: SUPPORTED_BARE,
        enabledWorkloads: enabledAll,
      });
      expect(d.applyExplicitCache).toBe(true);
      expect(d.reason).toBe('explicit_enabled');
      expect(d.ttl).toBe('1h');
    }
  });

  it('explicit + NOT enabled => false with workload_not_enabled', () => {
    const d = resolveCacheDecision({
      mode: 'explicit',
      ttl: '5m',
      workload: 'ask_wren',
      modelId: SUPPORTED_CRIS,
      enabledWorkloads: enabledNone,
    });
    expect(d.applyExplicitCache).toBe(false);
    expect(d.reason).toBe('workload_not_enabled');
  });

  it('explicit + enabled + UNKNOWN model => false with unsupported_model', () => {
    for (const model of [UNKNOWN_MODEL, NON_ANTHROPIC, '']) {
      const d = resolveCacheDecision({
        mode: 'explicit',
        ttl: '5m',
        workload: 'ask_wren',
        modelId: model,
        enabledWorkloads: enabledAll,
      });
      expect(d.applyExplicitCache).toBe(false);
      expect(d.reason).toBe('unsupported_model');
    }
  });

  it('accepts an iterable (array) for enabledWorkloads', () => {
    const d = resolveCacheDecision({
      mode: 'explicit',
      ttl: '5m',
      workload: 'feedback_primary',
      modelId: SUPPORTED_CRIS,
      enabledWorkloads: ['feedback_primary'],
    });
    expect(d.applyExplicitCache).toBe(true);
  });
});

describe('isCacheValidationError', () => {
  it('accepts a clear cache_control syntax rejection', () => {
    const err = Object.assign(new Error('Invalid cache_control block in messages'), {
      name: 'ValidationException',
    });
    expect(isCacheValidationError(err)).toBe(true);
  });

  it('accepts prompt-caching not-supported capability rejections', () => {
    expect(
      isCacheValidationError(
        new Error('ValidationException: prompt caching is not supported for this model'),
      ),
    ).toBe(true);
    expect(
      isCacheValidationError({
        __type: 'ValidationException',
        message: 'Unsupported cache checkpoint field',
      }),
    ).toBe(true);
  });

  it('rejects arbitrary / non-cache errors (no extra inference)', () => {
    expect(isCacheValidationError(new Error('ThrottlingException: rate exceeded'))).toBe(
      false,
    );
    expect(
      isCacheValidationError(new Error('AccessDeniedException: not authorized')),
    ).toBe(false);
    expect(
      isCacheValidationError(new Error('ValidationException: max_tokens too large')),
    ).toBe(false);
    expect(isCacheValidationError(new Error('some random failure'))).toBe(false);
  });

  it('rejects null/undefined/non-error inputs', () => {
    expect(isCacheValidationError(null)).toBe(false);
    expect(isCacheValidationError(undefined)).toBe(false);
    expect(isCacheValidationError(42)).toBe(false);
    expect(isCacheValidationError({})).toBe(false);
  });
});
