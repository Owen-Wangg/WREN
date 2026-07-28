/**
 * Unit tests for the real `LiteParse`-backed PDF-extraction adapter
 * (REQ-DOC-SUBMIT-01 criteria 3, 4; see `pdfExtractor.ts`).
 *
 * Uses hand-crafted PDF fixtures from `pdfFixtures.ts` and the REAL
 * `@llamaindex/liteparse` native binding — no mocking of the extractor.
 */
import { LiteParsePdfExtractor, resetLiteParseCache } from './pdfExtractor';
import { buildNoTextLayerPdf, buildTextPdf } from './pdfFixtures';

beforeEach(() => {
  resetLiteParseCache();
  process.env.PDF_OCR_ENABLED = 'false';
});

describe('LiteParsePdfExtractor', () => {
  it('extracts real text from a valid PDF with a text layer', async () => {
    const extractor = new LiteParsePdfExtractor();
    const text = await extractor.extract(buildTextPdf(14));
    expect(text).toContain('First paragraph text.');
    expect(text).toContain('Second paragraph text.');
  });

  it('preserves a paragraph boundary (blank line) when text lines are vertically far apart', async () => {
    const extractor = new LiteParsePdfExtractor();
    const text = await extractor.extract(buildTextPdf(60));
    expect(text).toMatch(/First paragraph text\.\s*\n\s*\n\s*Second paragraph text\./);
  });

  it('returns an empty string (not a throw) for a page with no recoverable text layer', async () => {
    const extractor = new LiteParsePdfExtractor();
    const text = await extractor.extract(buildNoTextLayerPdf());
    expect(text.trim()).toBe('');
  });

  it('throws on corrupt / non-PDF bytes rather than fabricating a success', async () => {
    const extractor = new LiteParsePdfExtractor();
    await expect(extractor.extract(Buffer.from('this is not a pdf at all'))).rejects.toThrow();
  });

  it('throws on an empty buffer', async () => {
    const extractor = new LiteParsePdfExtractor();
    await expect(extractor.extract(Buffer.alloc(0))).rejects.toThrow();
  });
});
