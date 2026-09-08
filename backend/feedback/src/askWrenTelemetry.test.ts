/**
 * Ask WREN telemetry tests (prompt-cache plan Task 3, OBSERVE mode).
 *
 * Assert that adding telemetry to `generateAskWrenReply`:
 *   - Does NOT change the returned reply (same as assertSocraticReply(text)).
 *   - Does NOT change the InvokeModel request body — still a plain-string
 *     `system`, no `cache_control` anywhere.
 *   - Emits an EMF event + structured log line to stdout with workload
 *     `ask_wren`, only workload+modelId dimensions, and no prompt text or
 *     student identifiers.
 *
 * No live AWS: we spy on `BedrockRuntimeClient.prototype.send` (same seam as
 * askWrenInvocation.characterization.test.ts) and capture `console.log`.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { assertSocraticReply, generateAskWrenReply } from './askWren';
import { EMF_NAMESPACE } from './bedrockTelemetry';

const MODEL_ENV = 'us.anthropic.claude-sonnet-4-6';

interface CapturedInvoke {
  modelId: string;
  body: Record<string, unknown>;
}

let sendSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;
let savedStackPrefix: string | undefined;
let savedModelId: string | undefined;

function stubBedrock(
  responseText: string,
  usage?: Record<string, number>,
): () => CapturedInvoke {
  let captured: CapturedInvoke | undefined;
  sendSpy = jest
    .spyOn(BedrockRuntimeClient.prototype, 'send')
    .mockImplementation((command: unknown) => {
      const input = (command as { input: Record<string, unknown> }).input;
      captured = {
        modelId: input.modelId as string,
        body: JSON.parse(new TextDecoder().decode(input.body as Uint8Array)),
      };
      const payload: Record<string, unknown> = {
        content: [{ type: 'text', text: responseText }],
        stop_reason: 'end_turn',
      };
      if (usage) payload.usage = usage;
      return Promise.resolve({
        body: new TextEncoder().encode(JSON.stringify(payload)),
        $metadata: { requestId: 'req-ask-wren-1' },
      }) as never;
    });
  return () => {
    if (!captured) throw new Error('send was never invoked');
    return captured;
  };
}

beforeAll(() => {
  savedStackPrefix = process.env.STACK_PREFIX;
  savedModelId = process.env.BEDROCK_MODEL_ID;
});

beforeEach(() => {
  delete process.env.STACK_PREFIX;
  process.env.BEDROCK_MODEL_ID = MODEL_ENV;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (savedStackPrefix === undefined) delete process.env.STACK_PREFIX;
  else process.env.STACK_PREFIX = savedStackPrefix;
  if (savedModelId === undefined) delete process.env.BEDROCK_MODEL_ID;
  else process.env.BEDROCK_MODEL_ID = savedModelId;
});

describe('generateAskWrenReply with observe-mode telemetry', () => {
  it('returns the same reply as assertSocraticReply and never adds cache_control', async () => {
    const modelText = 'Notice "the tribunal must consider" (early in the draft). What backs it?';
    const getCaptured = stubBedrock(modelText, {
      input_tokens: 1500,
      output_tokens: 60,
    });

    const reply = await generateAskWrenReply({
      userText: 'Is my thesis clear?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'the tribunal must consider all relevant evidence' }],
    });

    expect(reply).toBe(assertSocraticReply(modelText));

    const { body } = getCaptured();
    expect(typeof body.system).toBe('string');
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('emits an EMF event + log line with ask_wren workload and safe dimensions', async () => {
    stubBedrock('A short coaching nudge.', {
      input_tokens: 2048,
      output_tokens: 42,
    });

    await generateAskWrenReply({
      userText: 'Where is my argument weakest?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'This memo argues for a duty of disclosure.' }],
    });

    const emitted = logSpy.mock.calls.map((c) => String(c[0]));
    const emfLine = emitted.find((l) => l.includes('CloudWatchMetrics'));
    const logLine = emitted.find((l) => l.includes('bedrock_invocation'));
    expect(emfLine).toBeDefined();
    expect(logLine).toBeDefined();

    const emf = JSON.parse(emfLine as string);
    expect(emf._aws.CloudWatchMetrics[0].Namespace).toBe(EMF_NAMESPACE);
    expect(emf._aws.CloudWatchMetrics[0].Dimensions).toEqual([['workload', 'modelId']]);
    expect(emf.workload).toBe('ask_wren');
    expect(emf.modelId).toBe(MODEL_ENV);
    expect(emf.InputTokens).toBe(2048);
    expect(emf.OutputTokens).toBe(42);
    expect(emf.EstimatedCostUsd).toBeGreaterThan(0);

    const log = JSON.parse(logLine as string);
    expect(log.workload).toBe('ask_wren');
    expect(log.requestId).toBe('req-ask-wren-1');

    // Privacy: no prompt text, no student identifiers anywhere in telemetry.
    for (const line of [emfLine, logLine] as string[]) {
      expect(line).not.toContain('duty of disclosure');
      expect(line).not.toContain('argument weakest');
      for (const forbidden of ['userId', 'documentId', 'draftId', 'departmentId', 'jobId']) {
        expect(line).not.toContain(forbidden);
      }
    }
  });

  it('emits usage of all zeros when the model returns no usage block', async () => {
    stubBedrock('ok'); // no usage

    await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    const emfLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes('CloudWatchMetrics'));
    const emf = JSON.parse(emfLine as string);
    expect(emf.InputTokens).toBe(0);
    expect(emf.OutputTokens).toBe(0);
    expect(emf.CacheWriteInputTokens).toBe(0);
    expect(emf.CacheReadInputTokens).toBe(0);
  });
});
