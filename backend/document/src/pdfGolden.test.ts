/**
 * Golden fixtures: real PDF bytes → LiteParse extractRich → TipTap.
 *
 * Guards regression of server PDF formatting heuristics (headings, bold,
 * lists, indent). Fixtures are synthetic but exercise the full pipeline —
 * the same path Document Lambda uses on upload.
 */
import type { TipTapDoc, TipTapNode } from '@wren/types';

import { LiteParsePdfExtractor, resetLiteParseCache } from './pdfExtractor';
import {
  buildBulletListPdf,
  buildHeadingBodyPdf,
  buildIndentedParagraphPdf,
  buildInlineBoldPdf,
  buildTextPdf,
} from './pdfFixtures';

beforeEach(() => {
  resetLiteParseCache();
  // Digital text-layer fixtures — OCR off keeps runs deterministic in CI.
  process.env.PDF_OCR_ENABLED = 'false';
});

function blocksOf(content: TipTapDoc): TipTapNode[] {
  return (content.content as TipTapNode[] | undefined) ?? [];
}

function flattenText(node: TipTapNode | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map((c) => flattenText(c)).join('');
}

describe('PDF golden fixtures (LiteParse → TipTap)', () => {
  const extractor = new LiteParsePdfExtractor();

  it('maps a spaced two-paragraph PDF into TipTap paragraphs with recoverable text', async () => {
    const { text, content } = await extractor.extractRich(buildTextPdf(60));
    expect(text).toContain('First paragraph text.');
    expect(text).toContain('Second paragraph text.');
    const blocks = blocksOf(content);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const joined = blocks.map((b) => flattenText(b)).join('\n');
    expect(joined).toContain('First paragraph text.');
    expect(joined).toContain('Second paragraph text.');
  });

  it('promotes a larger title line to a heading above body copy', async () => {
    const { content } = await extractor.extractRich(buildHeadingBodyPdf());
    const blocks = blocksOf(content);
    const heading = blocks.find((b) => b.type === 'heading');
    const paragraph = blocks.find((b) => b.type === 'paragraph');
    expect(heading).toBeTruthy();
    expect(flattenText(heading)).toMatch(/Document Title/i);
    expect(paragraph).toBeTruthy();
    expect(flattenText(paragraph)).toMatch(/Body paragraph/i);
  });

  it('recovers mixed Helvetica / Helvetica-Bold line text end-to-end', async () => {
    // Mark-level bold depends on LiteParse emitting fontName; that path is
    // covered by pdfToTipTap unit tests with explicit SpatialTextItem fixtures.
    // This golden asserts the full PDF → extractRich → TipTap text survives.
    const { text, content } = await extractor.extractRich(buildInlineBoldPdf());
    expect(text).toMatch(/Hello/i);
    expect(text).toMatch(/world/i);
    const blocks = blocksOf(content);
    const joined = blocks.map((b) => flattenText(b)).join(' ');
    expect(joined).toMatch(/Hello/i);
    expect(joined).toMatch(/world/i);
  });

  it('maps asterisk bullet lines into a bulletList', async () => {
    const { content } = await extractor.extractRich(buildBulletListPdf());
    const blocks = blocksOf(content);
    const list = blocks.find((b) => b.type === 'bulletList');
    expect(list).toBeTruthy();
    expect(list?.content?.length).toBeGreaterThanOrEqual(2);
    const listText = flattenText(list);
    expect(listText).toMatch(/First list item/i);
    expect(listText).toMatch(/Second list item/i);
  });

  it('sets indent on a right-shifted body line', async () => {
    const { content } = await extractor.extractRich(buildIndentedParagraphPdf());
    const blocks = blocksOf(content);
    const indented = blocks.find((b) => flattenText(b).includes('Indented body line'));
    expect(indented?.type).toBe('paragraph');
    expect(Number(indented?.attrs?.indent ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
