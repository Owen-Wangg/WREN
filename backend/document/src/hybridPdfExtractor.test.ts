import type { TipTapDoc } from '@wren/types';

import { groupPageRuns, HybridPdfExtractor } from './hybridPdfExtractor';
import type {
  RichPdfExtractOptions,
  RichPdfExtraction,
  RichPdfExtractor,
  RichPdfPageGroupExtraction,
} from './pdfExtractor';
import type { SpatialPage } from './pdfToTipTap';
import { buildPdf, type PdfPageSpec } from './testFixtures/buildPdf';

class FakeOcr implements RichPdfExtractor {
  public constructor(private readonly rich: RichPdfExtraction) {}
  public async extract(): Promise<string> {
    return this.rich.text;
  }
  public async extractRich(): Promise<RichPdfExtraction> {
    return this.rich;
  }
}

/** Fake Textract that returns "OCR page N" per requested page group. */
class PageAwareFakeOcr implements RichPdfExtractor {
  public readonly calls: Array<RichPdfExtractOptions | undefined> = [];
  public async extract(): Promise<string> {
    return '';
  }
  public async extractRich(
    _bytes: Buffer,
    options?: RichPdfExtractOptions,
  ): Promise<RichPdfPageGroupExtraction> {
    this.calls.push(options);
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    if (options?.pageGroups) {
      const groups: TipTapDoc[] = options.pageGroups.map((g) => ({
        type: 'doc',
        content: g.map((n) => para(`Scanned exhibit text from page ${n}.`)),
      }));
      return {
        text: 'ocr',
        content: { type: 'doc', content: groups.flatMap((g) => g.content as unknown[]) },
        pageGroups: groups,
        ocrConfidence: 88.5,
      };
    }
    return {
      text: 'whole ocr',
      content: { type: 'doc', content: [para('Whole document OCR body.')] },
      ocrConfidence: 77,
    };
  }
}

function typedPage(label: string): PdfPageSpec {
  return {
    texts: [
      { text: `Typed memo section ${label}.`, x: 72, y: 100 },
      { text: 'The court dismissed the application for summary judgment.', x: 72, y: 130 },
    ],
  };
}

const scannedPage: PdfPageSpec = { images: [{ x: 0, y: 0, width: 612, height: 792 }] };

function plain(doc: TipTapDoc): string {
  const walk = (n: { text?: string; content?: unknown[] }): string =>
    typeof n.text === 'string'
      ? n.text
      : (n.content ?? []).map((c) => walk(c as { text?: string; content?: unknown[] })).join('');
  return ((doc.content ?? []) as Array<{ text?: string; content?: unknown[] }>)
    .map(walk)
    .join('\n');
}

const ocrDoc: TipTapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ocr body' }] }],
};

describe('HybridPdfExtractor', () => {
  it('uses the digital text layer when it has enough content', async () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Table of Contents', x: 40, y: 20, width: 140, height: 14, fontSize: 14 },
          { text: 'INTRODUCTION', x: 40, y: 50, width: 120, height: 12, fontSize: 12 },
          {
            text: 'The plaintiff seeks summary judgment on the trust claim.',
            x: 40,
            y: 80,
            width: 280,
            height: 12,
            fontSize: 12,
          },
        ],
      },
    ];
    const ocr = new FakeOcr({ text: 'ocr body', content: ocrDoc });
    const extractor = new HybridPdfExtractor(ocr, async () => pages);
    const rich = await extractor.extractRich(Buffer.from('%PDF'));
    expect(rich.text).not.toContain('ocr body');
    expect(JSON.stringify(rich.content)).toContain('Table of Contents');
    expect(JSON.stringify(rich.content)).toContain('INTRODUCTION');
    const types = ((rich.content.content ?? []) as Array<{ type?: string }>).map((n) => n.type);
    expect(types[0]).toBe('heading');
    expect(types[1]).toBe('heading');
  });

  it('falls back to OCR when the text layer is empty', async () => {
    const ocr = new FakeOcr({ text: 'ocr body', content: ocrDoc });
    const extractor = new HybridPdfExtractor(ocr, async () => [{ textItems: [] }]);
    const rich = await extractor.extractRich(Buffer.from('%PDF'));
    expect(rich.text).toContain('ocr body');
  });

  it('falls back to OCR when digital extract throws', async () => {
    const ocr = new FakeOcr({ text: 'ocr body', content: ocrDoc });
    const extractor = new HybridPdfExtractor(ocr, async () => {
      throw new Error('pdf.js failed');
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const rich = await extractor.extractRich(Buffer.from('%PDF'));
    err.mockRestore();
    expect(rich.text).toContain('ocr body');
  });
});

describe('HybridPdfExtractor per-page routing (real pdf.js)', () => {
  let info: jest.SpyInstance;
  beforeEach(() => {
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => info.mockRestore());

  it('never calls Textract for an all-digital PDF and sets no ocrConfidence', async () => {
    const ocr = new PageAwareFakeOcr();
    const rich = await new HybridPdfExtractor(ocr).extractRich(
      buildPdf([typedPage('one'), typedPage('two')]),
    );
    expect(ocr.calls).toHaveLength(0);
    expect(rich.ocrConfidence).toBeUndefined();
    expect(rich.text).toContain('Typed memo section one.');
    expect(rich.text).toContain('Typed memo section two.');
  });

  it('uses whole-document Textract when every page is scanned', async () => {
    const ocr = new PageAwareFakeOcr();
    const rich = await new HybridPdfExtractor(ocr).extractRich(
      buildPdf([scannedPage, scannedPage]),
    );
    expect(ocr.calls).toEqual([undefined]);
    expect(plain(rich.content)).toContain('Whole document OCR body.');
    expect(rich.ocrConfidence).toBe(77);
  });

  it('splices Textract pages between digital pages in page order', async () => {
    const ocr = new PageAwareFakeOcr();
    const rich = await new HybridPdfExtractor(ocr).extractRich(
      buildPdf([typedPage('one'), scannedPage, scannedPage, typedPage('four')]),
    );

    expect(ocr.calls).toHaveLength(1);
    expect(ocr.calls[0]?.pageGroups).toEqual([[2, 3]]);
    expect(rich.ocrConfidence).toBe(88.5);

    const text = plain(rich.content);
    const order = [
      'Typed memo section one.',
      'Scanned exhibit text from page 2.',
      'Scanned exhibit text from page 3.',
      'Typed memo section four.',
    ].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const routing = info.mock.calls.map((c) => String(c[0])).find((s) => s.includes('page routing'));
    expect(routing).toContain('"mode":"mixed"');
    expect(routing).toContain('"ocrPages":[2,3]');
  });
});

describe('groupPageRuns', () => {
  it('groups consecutive pages by source', () => {
    expect(groupPageRuns(['digital', 'ocr', 'ocr', 'digital', 'ocr'])).toEqual([
      { source: 'digital', pages: [1] },
      { source: 'ocr', pages: [2, 3] },
      { source: 'digital', pages: [4] },
      { source: 'ocr', pages: [5] },
    ]);
  });
});
