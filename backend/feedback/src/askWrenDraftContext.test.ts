/**
 * Ask WREN reads the draft as the student currently sees it.
 *
 * Autosave writes `draft.content` but never `draft.segments`, so reading
 * segments alone meant Ask WREN coached on the original upload, or saw nothing
 * for a document started blank in the editor. And the draft context used to be
 * cut to the first 40 paragraphs, so later sections of a long draft were never
 * sent. Asserts the TipTap content wins, the stored segments are the fallback,
 * and long drafts are sent whole up to a character budget, with any cut stated
 * outside the untrusted data block.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import {
  MAX_DRAFT_CONTEXT_CHARS,
  draftSegmentsFromColumns,
  formatDraftContext,
  generateAskWrenReply,
} from './askWren';

const EDITED_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Edited title' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Text typed after the upload.' }] },
  ],
};
const UPLOAD_SEGMENTS = [{ index: 0, text: 'Original uploaded paragraph.' }];

function captureUserContent(): () => string {
  const captured: string[] = [];
  jest.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation((command: unknown) => {
    const input = (command as { input: Record<string, unknown> }).input;
    const body = JSON.parse(new TextDecoder().decode(input.body as Uint8Array));
    const last = body.messages[body.messages.length - 1];
    captured.push(typeof last.content === 'string' ? last.content : JSON.stringify(last.content));
    const payload = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
    return Promise.resolve({
      body: new TextEncoder().encode(JSON.stringify(payload)),
      $metadata: { requestId: 'req-draft-context' },
    }) as never;
  });
  return () => captured[captured.length - 1]!;
}

function paragraphs(count: number, length = 60): Array<{ index: number; text: string }> {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    text: `Paragraph ${i} ${'x'.repeat(length)}`,
  }));
}

let savedModel: string | undefined;

beforeEach(() => {
  savedModel = process.env.BEDROCK_MODEL_ID;
  process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedModel === undefined) delete process.env.BEDROCK_MODEL_ID;
  else process.env.BEDROCK_MODEL_ID = savedModel;
});

describe('draftSegmentsFromColumns', () => {
  it('prefers the autosaved TipTap content over the frozen segments', () => {
    expect(draftSegmentsFromColumns(UPLOAD_SEGMENTS, EDITED_DOC).map((s) => s.text)).toEqual([
      'Edited title',
      'Text typed after the upload.',
    ]);
  });

  it('accepts JSON-string columns', () => {
    const fromContent = draftSegmentsFromColumns(
      JSON.stringify(UPLOAD_SEGMENTS),
      JSON.stringify(EDITED_DOC),
    );
    expect(fromContent.map((s) => s.text)).toContain('Text typed after the upload.');
    expect(draftSegmentsFromColumns(JSON.stringify(UPLOAD_SEGMENTS), null)).toEqual(
      UPLOAD_SEGMENTS,
    );
  });

  it('falls back to the stored segments when there is no TipTap doc', () => {
    expect(draftSegmentsFromColumns(UPLOAD_SEGMENTS, null)).toEqual(UPLOAD_SEGMENTS);
    expect(draftSegmentsFromColumns(UPLOAD_SEGMENTS, { type: 'paragraph' })).toEqual(
      UPLOAD_SEGMENTS,
    );
  });

  it('tolerates empty or malformed columns', () => {
    expect(draftSegmentsFromColumns(null, undefined)).toEqual([]);
    expect(draftSegmentsFromColumns('not json', 'not json')).toEqual([]);
  });
});

describe('formatDraftContext', () => {
  it('sends every paragraph of a draft longer than 40 paragraphs', () => {
    const { text, omitted } = formatDraftContext(paragraphs(120));
    expect(omitted).toBe(0);
    expect(text).toContain('Paragraph 0 ');
    expect(text).toContain('Paragraph 119 ');
    expect(text.split('\n')).toHaveLength(120);
  });

  it('keeps location hints spread across the whole draft', () => {
    const lines = formatDraftContext(paragraphs(100)).text.split('\n');
    expect(lines[0]).toMatch(/^\[early in the draft\]/);
    expect(lines[50]).toMatch(/^\[mid-draft\]/);
    expect(lines[99]).toMatch(/^\[near the end\]/);
  });

  it('stops at the character budget and counts what it left out', () => {
    const segments = paragraphs(100, 2_000);
    const { text, omitted } = formatDraftContext(segments);
    expect(text.length).toBeLessThanOrEqual(MAX_DRAFT_CONTEXT_CHARS + 100 * 20);
    expect(omitted).toBeGreaterThan(0);
    expect(text.split('\n')).toHaveLength(100 - omitted);
  });

  it('always sends the first paragraph, even one over the budget', () => {
    const { text, omitted } = formatDraftContext([
      { index: 0, text: 'y'.repeat(MAX_DRAFT_CONTEXT_CHARS + 10) },
      { index: 1, text: 'Second paragraph.' },
    ]);
    expect(text).toContain('y'.repeat(100));
    expect(omitted).toBe(1);
  });

  it('reports an empty draft', () => {
    expect(formatDraftContext([])).toEqual({
      text: '(Draft has no paragraph text yet.)',
      omitted: 0,
    });
    expect(formatDraftContext([{ index: 0, text: '' }]).text).toBe(
      '(Draft has no paragraph text yet.)',
    );
  });
});

describe('generateAskWrenReply — draft context', () => {
  const base = { userText: 'Is my conclusion strong?', priorMessages: [] };

  it('sends the edited text, not the original upload', async () => {
    const last = captureUserContent();
    await generateAskWrenReply({
      ...base,
      draftSegments: draftSegmentsFromColumns(UPLOAD_SEGMENTS, EDITED_DOC),
    });
    expect(last()).toContain('Text typed after the upload.');
    expect(last()).not.toContain('Original uploaded paragraph.');
  });

  it('states a truncation in the trusted header, outside the data block', async () => {
    const last = captureUserContent();
    await generateAskWrenReply({ ...base, draftSegments: paragraphs(100, 2_000) });
    const content = last();
    const header = content.slice(0, content.indexOf('BEGIN UNTRUSTED DATA'));
    expect(header).toMatch(/last \d+ paragraph\(s\) are not shown/);
  });

  it('keeps the plain header when the whole draft fits', async () => {
    const last = captureUserContent();
    await generateAskWrenReply({ ...base, draftSegments: paragraphs(3) });
    expect(last().startsWith('Draft context (paragraphs):\n')).toBe(true);
  });
});
