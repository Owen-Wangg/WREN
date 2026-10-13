/**
 * Ask WREN InvokeModel *characterization* tests (prompt-cache plan Task 2).
 *
 * These lock in the CURRENT pre-caching baseline of the request that
 * `generateAskWrenReply` sends to Amazon Bedrock so that any later prompt
 * restructuring for explicit caching (plan Sections 12.1 / 17) is a deliberate,
 * reviewable change rather than an accidental one.
 *
 * Baseline invariants asserted here (see docs/prompt-cache-plan.md §4.1):
 *   - Anthropic body: anthropic_version / max_tokens / temperature exact values.
 *   - `system` is a PLAIN STRING today — no content-block array, no cache_control.
 *     (When caching lands, §12.1 converts this to a block array with a checkpoint;
 *      that change must intentionally break the snapshot below.)
 *   - `messages` last element is the student's user turn (draft context + question).
 *   - The `{content:[{text}]}` response is parsed via `assertSocraticReply`.
 *   - `modelId` equals the resolved cross-region inference profile.
 *
 * No live AWS calls: we spy on `BedrockRuntimeClient.prototype.send` (the chosen
 * test seam — no production/runtime code change) and never let a real request
 * leave the process. Model resolution is forced through the env fallback by
 * unsetting STACK_PREFIX and setting BEDROCK_MODEL_ID.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { assertSocraticReply, generateAskWrenReply } from './askWren';

const MODEL_ENV = 'us.anthropic.claude-sonnet-4-6';

/** Capture of the single InvokeModelCommand the code under test dispatched. */
interface CapturedInvoke {
  modelId: string;
  contentType?: string;
  accept?: string;
  body: {
    anthropic_version: string;
    max_tokens: number;
    temperature: number;
    system: unknown;
    messages: Array<{ role: string; content: unknown }>;
  };
}

let sendSpy: jest.SpyInstance;
let savedStackPrefix: string | undefined;
let savedModelId: string | undefined;

/**
 * Install a spy on the shared BedrockRuntimeClient prototype that records the
 * dispatched InvokeModelCommand and returns a canned Anthropic response. Returns
 * a getter for the captured request.
 */
function stubBedrock(responseText: string): () => CapturedInvoke {
  let captured: CapturedInvoke | undefined;

  sendSpy = jest
    .spyOn(BedrockRuntimeClient.prototype, 'send')
    .mockImplementation((command: unknown) => {
      const input = (command as { input: Record<string, unknown> }).input;
      const rawBody = input.body as Uint8Array;
      captured = {
        modelId: input.modelId as string,
        contentType: input.contentType as string | undefined,
        accept: input.accept as string | undefined,
        body: JSON.parse(new TextDecoder().decode(rawBody)),
      };
      const payload = { content: [{ type: 'text', text: responseText }] };
      return Promise.resolve({
        body: new TextEncoder().encode(JSON.stringify(payload)),
      }) as never;
    });

  return () => {
    if (!captured) throw new Error('BedrockRuntimeClient.send was never invoked');
    return captured;
  };
}

beforeAll(() => {
  savedStackPrefix = process.env.STACK_PREFIX;
  savedModelId = process.env.BEDROCK_MODEL_ID;
});

beforeEach(() => {
  // Force the env-fallback branch of resolveBedrockModelId (no SSM call).
  delete process.env.STACK_PREFIX;
  process.env.BEDROCK_MODEL_ID = MODEL_ENV;
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

describe('generateAskWrenReply — current Bedrock InvokeModel baseline', () => {
  it('sends the exact anthropic_version, max_tokens, and temperature', async () => {
    const getCaptured = stubBedrock('A short Socratic nudge.');

    await generateAskWrenReply({
      userText: 'Is my thesis clear?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'The tribunal must consider all relevant evidence before ruling.' }],
    });

    const { body } = getCaptured();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.max_tokens).toBe(512);
    expect(body.temperature).toBe(0.4);
  });

  it('sends `system` as a PLAIN STRING with no content-block array and no cache_control', async () => {
    const getCaptured = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Where is my argument weakest?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'This paragraph introduces the central claim of the memo.' }],
    });

    const { body } = getCaptured();
    // Baseline: a single string, never an array of typed blocks.
    expect(typeof body.system).toBe('string');
    expect(Array.isArray(body.system)).toBe(false);
    // No explicit caching markers anywhere in the serialized request today.
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('snapshots the assembled `system` prompt string (byte-equivalence guard)', async () => {
    const getCaptured = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Does the intro set up the argument?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'An opening paragraph that frames the dispute.' }],
    });

    const { body } = getCaptured();
    // If caching restructures buildSystemPrompt output, this snapshot must be
    // updated intentionally — the concatenated block text has to stay
    // byte-equivalent to this baseline (plan §12.1).
    expect(body.system as string).toMatchSnapshot('ask-wren-system-prompt');
  });

  it('places the student turn last, carrying draft context and the question', async () => {
    const getCaptured = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Have I supported the second point?',
      priorMessages: [
        { id: 'm1', role: 'user', text: 'earlier question', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'm2', role: 'wren', text: 'earlier coaching reply', createdAt: '2024-01-01T00:00:01.000Z' },
      ],
      draftSegments: [{ index: 0, text: 'The second point asserts a duty of disclosure.' }],
    });

    const { body } = getCaptured();
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe('user');
    const content = String(last.content);
    expect(content).toContain('Draft context (paragraphs):');
    expect(content).toContain('Student question:');
    expect(content).toContain('Have I supported the second point?');

    // Prior wren turn is mapped to the Anthropic `assistant` role.
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user']);
  });

  it('parses `{content:[{text}]}` through assertSocraticReply and returns it', async () => {
    const modelText = 'Notice "the tribunal must consider" (early in the draft). What evidence supports that?';
    stubBedrock(modelText);

    const reply = await generateAskWrenReply({
      userText: 'Is this clear?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'the tribunal must consider all relevant evidence' }],
    });

    expect(reply).toBe(assertSocraticReply(modelText));
    expect(reply).toBe(modelText.trim());
  });

  it('targets the resolved cross-region inference profile as modelId', async () => {
    const getCaptured = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    const { modelId, contentType, accept } = getCaptured();
    expect(modelId).toBe(MODEL_ENV);
    expect(contentType).toBe('application/json');
    expect(accept).toBe('application/json');
  });
});
