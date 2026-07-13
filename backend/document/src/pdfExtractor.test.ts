/**
 * Unit tests for the real `LiteParse`-backed PDF-extraction adapter
 * (REQ-DOC-SUBMIT-01 criteria 3, 4; see `pdfExtractor.ts` for how LiteParse
 * is wired in and why OCR is left off).
 *
 * These build minimal, hand-crafted PDF byte fixtures (no external `.pdf`
 * test asset or PDF-writing library needed) and run them through the REAL
 * `@llamaindex/liteparse` native binding — no mocking of the extractor
 * itself — to verify actual end-to-end extraction behavior:
 *   - success path: recovers real text from a valid PDF with a text layer,
 *     preserving a paragraph boundary when lines are vertically far apart.
 *   - no-recoverable-text path: a page with no content stream (and OCR
 *     disabled) yields an empty string rather than throwing.
 *   - failure path: corrupt/non-PDF bytes throw, rather than silently
 *     succeeding with fabricated text.
 */
import { LiteParsePdfExtractor } from './pdfExtractor';

/**
 * Builds a minimal, syntactically valid single-page PDF with a real text
 * layer: two short lines of Helvetica text positioned `gapPt` PDF points
 * apart vertically. A large enough gap renders as a blank-line paragraph
 * break in LiteParse's plain-text output.
 */
function buildTextPdf(gapPt: number): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> ' +
    '/MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
  objs[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const secondLineY = 700 - gapPt;
  const stream =
    'BT /F1 12 Tf 72 700 Td (First paragraph text.) Tj ET\n' +
    `BT /F1 12 Tf 72 ${secondLineY} Td (Second paragraph text.) Tj ET\n`;
  objs[5] = `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = body.length;
    body += objs[i];
  }
  const xrefStart = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

/** A syntactically valid single-page PDF whose page has no content stream. */
function buildNoTextLayerPdf(): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n';

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 3; i++) {
    offsets[i] = body.length;
    body += objs[i];
  }
  const xrefStart = body.length;
  let xref = 'xref\n0 4\n0000000000 65535 f \n';
  for (let i = 1; i <= 3; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

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
