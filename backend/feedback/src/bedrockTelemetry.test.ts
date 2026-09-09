/**
 * Unit tests for the OBSERVE-MODE Bedrock telemetry module (prompt-cache Task 3).
 *
 * Covers: defensive usage parsing (full/partial/missing/garbage), table-driven
 * cost calc (known + unknown model, 5m vs 1h), EMF event shape, and the privacy
 * invariant that dimensions are ONLY [workload, modelId] and never carry
 * user/document/draft/department/job identifiers.
 */
import {
  buildEmfEvent,
  buildLogLine,
  emitTelemetry,
  estimateCost,
  EMF_NAMESPACE,
  InvocationUsage,
  parseInvocationUsage,
  resolveModelRates,
} from './bedrockTelemetry';

const KNOWN_MODEL = 'us.anthropic.claude-sonnet-4-6';
const UNKNOWN_MODEL = 'meta.llama3-70b-instruct-v1:0';

function usage(overrides: Partial<InvocationUsage> = {}): InvocationUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    modelId: KNOWN_MODEL,
    workload: 'ask_wren',
    latencyMs: 12,
    stopReason: 'end_turn',
    success: true,
    ...overrides,
  };
}

describe('parseInvocationUsage', () => {
  it('reads a full Anthropic usage block', () => {
    const parsed = parseInvocationUsage({
      usage: {
        input_tokens: 1200,
        output_tokens: 350,
        cache_creation_input_tokens: 800,
        cache_read_input_tokens: 400,
      },
    });
    expect(parsed).toEqual({
      input_tokens: 1200,
      output_tokens: 350,
      cache_creation_input_tokens: 800,
      cache_read_input_tokens: 400,
    });
  });

  it('defaults missing cache fields to 0 (partial usage)', () => {
    const parsed = parseInvocationUsage({
      usage: { input_tokens: 500, output_tokens: 120 },
    });
    expect(parsed).toEqual({
      input_tokens: 500,
      output_tokens: 120,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it('returns all zeros when usage is absent (older/other models)', () => {
    expect(parseInvocationUsage({ content: [{ text: 'hi' }] })).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it('tolerates non-object / null / garbage inputs without throwing', () => {
    const zero = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(parseInvocationUsage(null)).toEqual(zero);
    expect(parseInvocationUsage(undefined)).toEqual(zero);
    expect(parseInvocationUsage('nope')).toEqual(zero);
    expect(parseInvocationUsage({ usage: 'not-an-object' })).toEqual(zero);
    expect(
      parseInvocationUsage({ usage: { input_tokens: -5, output_tokens: 'x' } }),
    ).toEqual(zero);
  });
});

describe('resolveModelRates', () => {
  it('resolves seeded rates for the known model', () => {
    const rates = resolveModelRates(KNOWN_MODEL);
    expect(rates).toEqual({
      inputPerMillion: 3.0,
      cacheWrite5mPerMillion: 3.75,
      cacheWrite1hPerMillion: 6.0,
      cacheReadPerMillion: 0.3,
      outputPerMillion: 15.0,
    });
  });

  it('returns undefined for unknown models', () => {
    expect(resolveModelRates(UNKNOWN_MODEL)).toBeUndefined();
  });

  it('returns undefined when as-of date predates the effective date', () => {
    expect(resolveModelRates(KNOWN_MODEL, new Date('2020-01-01'))).toBeUndefined();
  });
});

describe('estimateCost (table-driven)', () => {
  const rates = resolveModelRates(KNOWN_MODEL);

  const cases: Array<{
    name: string;
    tokens: Pick<
      InvocationUsage,
      | 'input_tokens'
      | 'output_tokens'
      | 'cache_creation_input_tokens'
      | 'cache_read_input_tokens'
    >;
    ttl?: '5m' | '1h';
    expectActual: number;
    expectUncached: number;
    expectSavings: number;
  }> = [
    {
      name: 'observe baseline (no cache): actual == uncached, savings 0',
      tokens: {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      expectActual: 3.0,
      expectUncached: 3.0,
      expectSavings: 0,
    },
    {
      name: 'output tokens priced at 15/M',
      tokens: {
        input_tokens: 0,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      expectActual: 15.0,
      expectUncached: 15.0,
      expectSavings: 0,
    },
    {
      name: '5m cache write + read shows savings vs uncached-equiv',
      tokens: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      },
      ttl: '5m',
      // actual = 1M*3.75 + 1M*0.30 = 4.05 ; uncached = 2M*3.00 = 6.00
      expectActual: 4.05,
      expectUncached: 6.0,
      expectSavings: 1.95,
    },
    {
      name: '1h cache write uses the 6.00 rate',
      tokens: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 0,
      },
      ttl: '1h',
      expectActual: 6.0,
      expectUncached: 3.0,
      expectSavings: -3.0,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const cost = estimateCost(c.tokens, rates, c.ttl);
      expect(cost).toBeDefined();
      expect(cost!.actualUsd).toBeCloseTo(c.expectActual, 6);
      expect(cost!.uncachedEquivUsd).toBeCloseTo(c.expectUncached, 6);
      expect(cost!.savingsUsd).toBeCloseTo(c.expectSavings, 6);
    });
  }

  it('returns undefined for unknown model (rates undefined)', () => {
    const cost = estimateCost(
      {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      resolveModelRates(UNKNOWN_MODEL),
    );
    expect(cost).toBeUndefined();
  });
});

describe('buildEmfEvent shape + privacy', () => {
  const FORBIDDEN = [
    'userId',
    'documentId',
    'draftId',
    'departmentId',
    'jobId',
    'user_id',
    'document_id',
    'draft_id',
    'department_id',
    'job_id',
  ];

  it('has WREN/Bedrock namespace and only workload+modelId dimensions', () => {
    const event = buildEmfEvent(
      usage({ input_tokens: 1000, output_tokens: 200 }),
      { timestampMs: 1_700_000_000_000 },
    );
    const md = event._aws.CloudWatchMetrics[0];
    expect(md.Namespace).toBe(EMF_NAMESPACE);
    expect(md.Dimensions).toEqual([['workload', 'modelId']]);
    expect(event.workload).toBe('ask_wren');
    expect(event.modelId).toBe(KNOWN_MODEL);
    expect(event.Invocations).toBe(1);
    expect(event.InputTokens).toBe(1000);
    expect(event.OutputTokens).toBe(200);
    expect(event._aws.Timestamp).toBe(1_700_000_000_000);
  });

  it('includes cost metrics for a known model and omits them for unknown', () => {
    const known = buildEmfEvent(usage({ input_tokens: 1000 }));
    expect(known.EstimatedCostUsd).toBeDefined();
    expect(known.EstimatedSavingsUsd).toBeDefined();
    const knownNames = known._aws.CloudWatchMetrics[0].Metrics.map((m) => m.Name);
    expect(knownNames).toEqual(
      expect.arrayContaining([
        'Invocations',
        'InputTokens',
        'OutputTokens',
        'CacheWriteInputTokens',
        'CacheReadInputTokens',
        'CacheEligibleInvocations',
        'CacheFallbacks',
        'InvocationLatency',
        'EstimatedCostUsd',
        'EstimatedSavingsUsd',
      ]),
    );

    const unknown = buildEmfEvent(usage({ modelId: UNKNOWN_MODEL, input_tokens: 1000 }));
    expect(unknown.EstimatedCostUsd).toBeUndefined();
    expect(unknown.EstimatedSavingsUsd).toBeUndefined();
    const unknownNames = unknown._aws.CloudWatchMetrics[0].Metrics.map((m) => m.Name);
    expect(unknownNames).not.toContain('EstimatedCostUsd');
  });

  it('never emits forbidden identifier keys in EMF or log line', () => {
    const event = buildEmfEvent(usage({ input_tokens: 5 }), {
      requestId: 'req-abc-123',
    });
    const line = buildLogLine(usage({ input_tokens: 5 }), {
      requestId: 'req-abc-123',
    });
    const emfKeys = Object.keys(event);
    const logJson = JSON.stringify(line);
    for (const forbidden of FORBIDDEN) {
      expect(emfKeys).not.toContain(forbidden);
      expect(logJson).not.toContain(forbidden);
    }
    // Dimension set contains ONLY the two permitted names.
    expect(event._aws.CloudWatchMetrics[0].Dimensions[0].sort()).toEqual(
      ['modelId', 'workload'],
    );
  });

  it('log line keeps requestId (logs only) but never as a dimension', () => {
    const event = buildEmfEvent(usage(), { requestId: 'req-xyz' });
    const line = buildLogLine(usage(), { requestId: 'req-xyz' });
    expect(line.requestId).toBe('req-xyz');
    expect(event._aws.CloudWatchMetrics[0].Dimensions[0]).not.toContain('requestId');
    // requestId must not be promoted to a top-level EMF field either.
    expect((event as unknown as Record<string, unknown>).requestId).toBeUndefined();
  });
});

describe('emitTelemetry', () => {
  it('writes an EMF line and a structured log line to the sink, never throws', () => {
    const lines: string[] = [];
    expect(() =>
      emitTelemetry(usage({ input_tokens: 10, output_tokens: 3 }), {
        log: (l) => lines.push(l),
        timestampMs: 1,
      }),
    ).not.toThrow();
    expect(lines).toHaveLength(2);
    const emf = JSON.parse(lines[0]);
    const log = JSON.parse(lines[1]);
    expect(emf._aws.CloudWatchMetrics[0].Namespace).toBe(EMF_NAMESPACE);
    expect(log.event).toBe('bedrock_invocation');
    expect(log.input_tokens).toBe(10);
  });
});
