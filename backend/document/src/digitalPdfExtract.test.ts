/**
 * Real pdf.js tests for the digital text-layer path. PDFs are generated in
 * code (no committed documents) and passed as Node Buffers, which is what
 * every ingest caller provides.
 */
import type { TipTapNode } from '@wren/types';

import {
  describePdfjsFont,
  extractSpatialPagesFromPdf,
  imageCoverageFromOperatorList,
  pageNeedsOcr,
} from './digitalPdfExtract';
import { spatialPagesToTipTap } from './pdfToTipTap';
import { buildPdf, type PdfPageSpec } from './testFixtures/buildPdf';

const BODY =
  'The plaintiff seeks an order that a gift of a half-interest as a joint tenant was valid.';

function textPage(lines: string[] = [BODY]): PdfPageSpec {
  return { texts: lines.map((text, i) => ({ text, x: 72, y: 100 + i * 20 })) };
}

function allText(nodes: TipTapNode[]): string {
  const walk = (n: TipTapNode): string =>
    typeof n.text === 'string' ? n.text : (n.content ?? []).map(walk).join('');
  return nodes.map(walk).join('\n');
}

function textNodes(nodes: TipTapNode[]): TipTapNode[] {
  return nodes.flatMap((n) => (n.type === 'text' ? [n] : textNodes(n.content ?? [])));
}

describe('extractSpatialPagesFromPdf (real pdf.js)', () => {
  it('accepts a Node Buffer and returns positioned text items', async () => {
    const pdf = buildPdf([
      {
        texts: [
          { text: 'IN THE SUPREME COURT OF BRITISH COLUMBIA', x: 150, y: 100, size: 14 },
          { text: 'Counsel for the Defendant K. MacEwan', x: 72, y: 140 },
        ],
      },
    ]);
    expect(Buffer.isBuffer(pdf)).toBe(true);

    const pages = await extractSpatialPagesFromPdf(pdf);

    expect(pages).toHaveLength(1);
    const texts = pages[0]!.textItems.map((i) => i.text);
    expect(texts.join(' ')).toContain('IN THE SUPREME COURT OF BRITISH COLUMBIA');
    expect(texts.join(' ')).toContain('MacEwan');
    const title = pages[0]!.textItems.find((i) => i.text.startsWith('IN THE'))!;
    expect(title.x).toBeCloseTo(150, 0);
    expect(title.fontSize).toBeCloseTo(14, 0);
  });

  it('resolves real font names so bold and italic survive conversion', async () => {
    const pdf = buildPdf([
      {
        texts: [
          { text: 'Reasons for Judgment', x: 200, y: 100, size: 14, font: 'bold' },
          { text: 'Pearman v. Kuramoto', x: 72, y: 140, font: 'italic' },
          { text: BODY, x: 72, y: 170 },
        ],
      },
    ]);
    const pages = await extractSpatialPagesFromPdf(pdf);
    const fonts = pages[0]!.textItems.map((i) => i.fontName);
    expect(fonts).toEqual(expect.arrayContaining(['Helvetica-Bold', 'Helvetica-Oblique']));

    const nodes = (spatialPagesToTipTap(pages).content ?? []) as TipTapNode[];
    const runs = textNodes(nodes);
    const caseName = runs.find((n) => n.text?.includes('Pearman v. Kuramoto'));
    expect(caseName?.marks?.some((m) => m.type === 'italic')).toBe(true);
    const title = nodes.find((n) => allText([n]).includes('Reasons for Judgment'));
    const titleBold =
      title?.type === 'heading' ||
      textNodes([title!]).some((n) => n.marks?.some((m) => m.type === 'bold'));
    expect(titleBold).toBe(true);
    // Exact text: no OCR case errors.
    expect(allText(nodes)).toContain('Pearman v. Kuramoto');
  });

  it('drops a rotated margin stamp so it cannot skew layout', async () => {
    const pdf = buildPdf([
      {
        texts: [
          { text: 'Between:', x: 72, y: 100 },
          { text: BODY, x: 72, y: 130 },
          { text: '2024 BCSC 1953', x: 590, y: 500, size: 9, rotate: 90 },
          { text: '(CanLII)', x: 590, y: 420, size: 9, rotate: 90 },
        ],
      },
    ]);
    const pages = await extractSpatialPagesFromPdf(pdf);
    const texts = pages[0]!.textItems.map((i) => i.text).join(' ');
    expect(texts).not.toContain('BCSC');
    expect(texts).not.toContain('CanLII');
    expect(allText((spatialPagesToTipTap(pages).content ?? []) as TipTapNode[])).not.toContain(
      'BCSC',
    );
  });

  it('measures image coverage and classifies pages for OCR routing', async () => {
    const pdf = buildPdf([
      textPage(),
      { images: [{ x: 0, y: 0, width: 612, height: 792 }] },
      { ...textPage(), images: [{ x: 0, y: 0, width: 612, height: 600 }] },
      {},
      { ...textPage(), images: [{ x: 72, y: 20, width: 60, height: 40 }] },
    ]);
    const pages = await extractSpatialPagesFromPdf(pdf);

    expect(pages.map((p) => Number((p.imageCoverage ?? -1).toFixed(2)))).toEqual([
      0,
      1,
      Number((600 / 792).toFixed(2)),
      0,
      Number(((60 * 40) / (612 * 792)).toFixed(2)),
    ]);
    // text page, full scan, text over a big image, blank page, text + small logo
    expect(pages.map(pageNeedsOcr)).toEqual([false, true, true, false, false]);
  });
});

describe('pageNeedsOcr', () => {
  it('treats a text-poor page with unknown coverage as scanned', () => {
    expect(pageNeedsOcr({ textItems: [], textChars: 0 })).toBe(true);
    expect(pageNeedsOcr({ textItems: [], textChars: 200 })).toBe(false);
  });

  it('routes half-covered text-poor pages to OCR but keeps text-rich ones', () => {
    expect(pageNeedsOcr({ textItems: [], textChars: 5, imageCoverage: 0.5 })).toBe(true);
    expect(pageNeedsOcr({ textItems: [], textChars: 500, imageCoverage: 0.5 })).toBe(false);
    expect(pageNeedsOcr({ textItems: [], textChars: 500, imageCoverage: 0.51 })).toBe(true);
    expect(pageNeedsOcr({ textItems: [], textChars: 0, imageCoverage: 0 })).toBe(false);
  });
});

describe('describePdfjsFont', () => {
  it('strips subset tags and adds style suffixes from flags', () => {
    expect(describePdfjsFont({ name: 'ABCDEF+Arial-BoldMT', bold: true })).toBe('Arial-BoldMT');
    expect(describePdfjsFont({ name: 'TimesNewRoman', italic: true })).toBe(
      'TimesNewRoman-Italic',
    );
    expect(describePdfjsFont({ name: 'Calibri', bold: true, italic: true })).toBe(
      'Calibri-Bold-Italic',
    );
    expect(describePdfjsFont(null)).toBeUndefined();
  });
});

describe('imageCoverageFromOperatorList', () => {
  const ops = { save: 1, restore: 2, transform: 3, paintImageXObject: 4 };

  it('tracks the CTM through save / transform / restore and clips to the page', () => {
    const coverage = imageCoverageFromOperatorList(
      {
        fnArray: [1, 3, 3, 4, 2, 4],
        // translate then scale to 200×100, then an image at identity (1pt²)
        argsArray: [null, [1, 0, 0, 1, 50, 50], [200, 0, 0, 100, 0, 0], ['img', 2, 2], null, ['i', 1, 1]],
      },
      ops,
      [0, 0, 400, 400],
    );
    expect(coverage).toBeCloseTo((200 * 100 + 1) / (400 * 400), 5);
  });
});
