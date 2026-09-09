/**
 * Ask WREN trusted-prefix caching tests (prompt-cache plan Task 5, §7/§10/§12.1/§15).
 *
 * These lock in the Task 5 behavior: caching the stable trusted system prefix ONLY
 * when explicit caching is enabled for the ask_wren workload, and being a strict
 * no-op otherwise. Guardrails asserted here:
 *   - Byte-equivalence: buildSystemPromptBlocks(...).join('') === buildSystemPrompt(...).
 *   - Observe/off default: `system` stays a plain string, no cache_control anywhere.
 *   - Explicit + ask_wren + supported model: `system` is an array, ONLY the LAST
 *     block carries cache_control, ttl honored for 1h, and NO message is marked.
 *   - Unknown model / workload-not-enabled: falls back to a plain-string system.
 *   - Returned reply equals assertSocraticReply(text) on cached and uncached paths.
 *   - A cache_control ValidationException triggers exactly ONE uncached retry;
 *     an arbitrary error does NOT retry.
 *
 * No live AWS: we spy on `BedrockRuntimeClient.prototype.send` (same seam as the
 * characterization + telemetry tests) and never let a real request leave.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import {
  assertSocraticReply,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  generateAskWrenReply,
  type DocumentTypeContext,
} from './askWren';

const MODEL_SUPPORTED = 'us.anthropic.claude-sonnet-4-6';
const MODEL_UNKNOWN = 'meta.llama3-70b-instruct-v1:0';

interface CapturedInvoke {
  modelId: string;
  body: {
    system: unknown;
    messages: Array<{ role: string; content: unknown }>;
  };
}

let sendSpy: jest.SpyInstance;
let savedEnv: Record<string, string | undefined>;

/**
 * Spy on the shared BedrockRuntimeClient prototype: record every dispatched
 * InvokeModelCommand body and return a canned Anthropic response. Returns getters
 * for the LAST captured request and the full list of captured requests (so retry
 * behavior can be asserted).
 */
function stubBedrock(responseText: string): {
  last: () => CapturedInvoke;
  all: () => CapturedInvoke[];
} {
  const captured: CapturedInvoke[] = [];
  sendSpy = jest
    .spyOn(BedrockRuntimeClient.prototype, 'send')
    .mockImplementation((command: unknown) => {
      const input = (command as { input: Record<string, unknown> }).input;
      captured.push({
        modelId: input.modelId as string,
        body: JSON.parse(new TextDecoder().decode(input.body as Uint8Array)),
      });
      const payload = { content: [{ type: 'text', text: responseText }], stop_reason: 'end_turn' };
      return Promise.resolve({
        body: new TextEncoder().encode(JSON.stringify(payload)),
        $metadata: { requestId: 'req-ask-wren-cache' },
      }) as never;
    });
  return {
    last: () => {
      if (!captured.length) throw new Error('send was never invoked');
      return captured[captured.length - 1];
    },
    all: () => captured,
  };
}

const CACHE_ENV_KEYS = [
  'STACK_PREFIX',
  'BEDROCK_MODEL_ID',
  'CACHE_MODE',
  'CACHE_TTL',
  'CACHE_ENABLED_WORKLOADS',
];

beforeAll(() => {
  savedEnv = {};
  for (const k of CACHE_ENV_KEYS) savedEnv[k] = process.env[k];
});

beforeEach(() => {
  // Clean slate: unset all cache + model env; force the env-fallback model branch.
  for (const k of CACHE_ENV_KEYS) delete process.env[k];
  process.env.BEDROCK_MODEL_ID = MODEL_SUPPORTED;
  // Silence telemetry stdout so it does not pollute test output.
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const k of CACHE_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const docTypeCtx: DocumentTypeContext = {
  documentTypeName: 'Legal Memo',
  purpose: 'Advise a partner on a discrete legal question.',
  restrictions: 'Do not editorialize.',
  notes: 'Cite authority.',
  categories: [
    { name: 'Clarity', definition: 'Is the reasoning legible?', criteria: 'One idea per paragraph.' },
  ],
};
const departmentCtx = 'Law students writing legal memoranda.';

describe('buildSystemPromptBlocks — byte-equivalence with buildSystemPrompt', () => {
  const cases: Array<[string, DocumentTypeContext | undefined, string | undefined]> = [
    ['no context', undefined, undefined],
    ['department only', undefined, departmentCtx],
    ['document-type only', docTypeCtx, undefined],
    ['both', docTypeCtx, departmentCtx],
  ];

  it.each(cases)('plain concat of blocks equals the string (%s)', (_label, ctx, dept) => {
    const blocks = buildSystemPromptBlocks(ctx, dept);
    expect(blocks.join('')).toBe(buildSystemPrompt(ctx, dept));
  });
});

describe('generateAskWrenReply — observe/off default is a strict no-op', () => {
  it('leaves `system` a plain string with no cache_control when CACHE_MODE is unset', async () => {
    const capture = stubBedrock('ok');

    const reply = await generateAskWrenReply({
      userText: 'Is my thesis clear?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'The tribunal must consider all relevant evidence.' }],
    });

    const { body } = capture.last();
    expect(typeof body.system).toBe('string');
    expect(Array.isArray(body.system)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('cache_control');
    expect(reply).toBe(assertSocraticReply('ok'));
  });

  it('leaves `system` a plain string when CACHE_MODE=observe (workloads enabled)', async () => {
    process.env.CACHE_MODE = 'observe';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';
    const capture = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    const { body } = capture.last();
    expect(typeof body.system).toBe('string');
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});

describe('generateAskWrenReply — explicit caching for ask_wren', () => {
  it('sends `system` as an array with cache_control only on the LAST block; no message marked', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';
    const capture = stubBedrock('A short coaching nudge.');

    await generateAskWrenReply({
      userText: 'Where is my argument weakest?',
      priorMessages: [
        { id: 'm1', role: 'user', text: 'earlier question', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'm2', role: 'wren', text: 'earlier reply', createdAt: '2024-01-01T00:00:01.000Z' },
      ],
      draftSegments: [{ index: 0, text: 'This memo argues for a duty of disclosure.' }],
      documentTypeContext: docTypeCtx,
      departmentAskWrenContext: departmentCtx,
    });

    const { body } = capture.last();
    expect(Array.isArray(body.system)).toBe(true);
    const blocks = body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(blocks.length).toBeGreaterThan(1);

    // Only the LAST block carries cache_control.
    blocks.forEach((block, i) => {
      expect(block.type).toBe('text');
      if (i === blocks.length - 1) {
        expect(block.cache_control).toEqual({ type: 'ephemeral' });
      } else {
        expect(block.cache_control).toBeUndefined();
      }
    });

    // Byte-equivalence preserved in the actual request.
    expect(blocks.map((b) => b.text).join('')).toBe(
      buildSystemPrompt(docTypeCtx, departmentCtx),
    );

    // No message carries a cache marker.
    for (const message of body.messages) {
      expect(JSON.stringify(message)).not.toContain('cache_control');
    }
  });

  it('honors ttl=1h on the final block', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_TTL = '1h';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';
    const capture = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    const blocks = capture.last().body.system as Array<{ cache_control?: unknown }>;
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('returns assertSocraticReply(text) on the cached path', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';
    const modelText = 'Notice "duty of disclosure" (early in the draft). What supports it?';
    stubBedrock(modelText);

    const reply = await generateAskWrenReply({
      userText: 'Is this clear?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'This memo argues for a duty of disclosure here.' }],
    });

    expect(reply).toBe(assertSocraticReply(modelText));
  });
});

describe('generateAskWrenReply — falls back to string system when caching does not apply', () => {
  it('unknown/unsupported model => plain-string system, no markers', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';
    process.env.BEDROCK_MODEL_ID = MODEL_UNKNOWN;
    const capture = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    const { body } = capture.last();
    expect(typeof body.system).toBe('string');
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('workload not enabled => plain-string system, no markers', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_ENABLED_WORKLOADS = 'feedback_primary';
    const capture = stubBedrock('ok');

    await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    const { body } = capture.last();
    expect(typeof body.system).toBe('string');
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});

describe('generateAskWrenReply — cache-validation-error fallback', () => {
  it('retries ONCE uncached on a cache_control ValidationException, then succeeds', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';

    const captured: Array<{ system: unknown }> = [];
    let call = 0;
    sendSpy = jest
      .spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockImplementation((command: unknown) => {
        const input = (command as { input: Record<string, unknown> }).input;
        const body = JSON.parse(new TextDecoder().decode(input.body as Uint8Array));
        captured.push({ system: body.system });
        call += 1;
        if (call === 1) {
          return Promise.reject(
            Object.assign(new Error('Invalid cache_control block in system'), {
              name: 'ValidationException',
            }),
          ) as never;
        }
        return Promise.resolve({
          body: new TextEncoder().encode(
            JSON.stringify({ content: [{ type: 'text', text: 'recovered' }], stop_reason: 'end_turn' }),
          ),
          $metadata: { requestId: 'req-retry' },
        }) as never;
      });

    const reply = await generateAskWrenReply({
      userText: 'Any gaps?',
      priorMessages: [],
      draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
    });

    // Exactly two sends: cached attempt (array) then uncached retry (string).
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(Array.isArray(captured[0].system)).toBe(true);
    expect(typeof captured[1].system).toBe('string');
    expect(reply).toBe(assertSocraticReply('recovered'));
  });

  it('does NOT retry on an arbitrary (non-cache) error', async () => {
    process.env.CACHE_MODE = 'explicit';
    process.env.CACHE_ENABLED_WORKLOADS = 'ask_wren';

    sendSpy = jest
      .spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockImplementation(
        () =>
          Promise.reject(
            Object.assign(new Error('ThrottlingException: rate exceeded'), {
              name: 'ThrottlingException',
            }),
          ) as never,
      );

    await expect(
      generateAskWrenReply({
        userText: 'Any gaps?',
        priorMessages: [],
        draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
      }),
    ).rejects.toThrow('rate exceeded');

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
