import type { TipTapDoc } from '@wren/types';

import { HybridPdfExtractor } from './hybridPdfExtractor';
import type { RichPdfExtraction, RichPdfExtractor } from './pdfExtractor';
import type { SpatialPage } from './pdfToTipTap';

class FakeOcr implements RichPdfExtractor {
  public constructor(private readonly rich: RichPdfExtraction) {}
  public async extract(): Promise<string> {
    return this.rich.text;
  }
  public async extractRich(): Promise<RichPdfExtraction> {
    return this.rich;
  }
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
