/**
 * Ask WREN sees the repeating page header/footer.
 *
 * The header and footer live in `draft.header` / `draft.footer`, outside the
 * segments, so without this block Ask WREN told students their running head or
 * page numbers were missing. Asserts the flattening matches the Python engine's
 * `page_region_text`, the block is sent only when present, and a draft without
 * one sends the same user content as before.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { generateAskWrenReply, pageRegionText, pageRegionsFromColumns } from './askWren';

const HEADER_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'SLEEP AND MEMORY ' }, { type: 'pageNumber' }],
    },
  ],
};
const FOOTER_DOC = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'PSYC 201' }] },
    { type: 'paragraph', content: [{ type: 'date' }] },
  ],
};

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
      $metadata: { requestId: 'req-page-regions' },
    }) as never;
  });
  return () => captured[captured.length - 1]!;
}

const maskTokens = (text: string) => text.replace(/\[[0-9a-f]{32}\]/g, '[TOKEN]');

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

describe('pageRegionText', () => {
  it('renders chips as placeholders and joins blocks on one line', () => {
    expect(pageRegionText(HEADER_DOC)).toBe('SLEEP AND MEMORY [page number]');
    expect(pageRegionText(FOOTER_DOC)).toBe('PSYC 201 / [date]');
  });

  it('collapses newlines and hard breaks so text cannot forge lines', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A\nB' },
            { type: 'hardBreak' },
            { type: 'text', text: 'C\r\nD' },
          ],
        },
      ],
    };
    expect(pageRegionText(doc)).toBe('A B / C D');
  });

  it('accepts JSON strings and tolerates empty or malformed input', () => {
    expect(pageRegionText(JSON.stringify(HEADER_DOC))).toBe('SLEEP AND MEMORY [page number]');
    expect(pageRegionText(null)).toBe('');
    expect(pageRegionText('not json')).toBe('');
    expect(pageRegionsFromColumns(null, undefined)).toEqual({ header: '', footer: '' });
  });
});

describe('generateAskWrenReply — page header/footer context', () => {
  const base = {
    userText: 'Is my running head formatted correctly?',
    priorMessages: [],
    draftSegments: [{ index: 0, text: 'Sleep deprivation impairs working memory.' }],
  };

  it('sends the header/footer in its own untrusted block when present', async () => {
    const last = captureUserContent();
    await generateAskWrenReply({
      ...base,
      pageRegions: pageRegionsFromColumns(HEADER_DOC, FOOTER_DOC),
    });
    const content = last();
    expect(content).toContain('label=student_page_header_footer');
    expect(content).toContain('HEADER (top of every page): SLEEP AND MEMORY [page number]');
    expect(content).toContain('FOOTER (bottom of every page): PSYC 201 / [date]');
  });

  it('sends unchanged content when the draft has no header/footer', async () => {
    const last = captureUserContent();
    await generateAskWrenReply(base);
    const without = maskTokens(last());
    await generateAskWrenReply({ ...base, pageRegions: { header: '', footer: '' } });
    expect(maskTokens(last())).toBe(without);
    expect(without).not.toContain('student_page_header_footer');
  });
});
