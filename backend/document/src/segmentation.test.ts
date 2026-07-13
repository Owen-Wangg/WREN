/**
 * Unit tests for the pure paragraph-segmentation core (REQ-DOC-SUBMIT-01
 * criteria 2, 3, 5; design Properties 1–2 target this module).
 */
import { segmentParagraphs } from './segmentation';

describe('segmentParagraphs', () => {
  it('returns a single segment for a single paragraph', () => {
    const segments = segmentParagraphs('Just one paragraph of text.');
    expect(segments).toEqual([{ index: 0, text: 'Just one paragraph of text.' }]);
  });

  it('splits multiple blank-line-separated paragraphs with stable ordered indices', () => {
    const segments = segmentParagraphs('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    expect(segments).toEqual([
      { index: 0, text: 'First paragraph.' },
      { index: 1, text: 'Second paragraph.' },
      { index: 2, text: 'Third paragraph.' },
    ]);
  });

  it('treats a run of more than two newlines as a single boundary', () => {
    const segments = segmentParagraphs('Alpha.\n\n\n\nBeta.');
    expect(segments).toEqual([
      { index: 0, text: 'Alpha.' },
      { index: 1, text: 'Beta.' },
    ]);
  });

  it('treats a single newline within a paragraph as a soft break, not a boundary', () => {
    const segments = segmentParagraphs('Line one\nLine two still same paragraph.');
    expect(segments).toEqual([{ index: 0, text: 'Line one\nLine two still same paragraph.' }]);
  });

  it('trims leading/trailing whitespace on each paragraph', () => {
    const segments = segmentParagraphs('  Padded paragraph.  \n\n  Another one.  ');
    expect(segments).toEqual([
      { index: 0, text: 'Padded paragraph.' },
      { index: 1, text: 'Another one.' },
    ]);
  });

  it('drops empty paragraphs created by leading/trailing/extra blank-line runs', () => {
    const segments = segmentParagraphs('\n\n\n  First.  \n\n\n  Second.  \n\n\n');
    expect(segments).toEqual([
      { index: 0, text: 'First.' },
      { index: 1, text: 'Second.' },
    ]);
  });

  it('returns an empty ordered list for empty input', () => {
    expect(segmentParagraphs('')).toEqual([]);
  });

  it('returns an empty ordered list for whitespace-only input', () => {
    expect(segmentParagraphs('   \n\n   \n\n  ')).toEqual([]);
  });

  it('normalizes CRLF line endings the same as LF', () => {
    const segments = segmentParagraphs('One.\r\n\r\nTwo.');
    expect(segments).toEqual([
      { index: 0, text: 'One.' },
      { index: 1, text: 'Two.' },
    ]);
  });

  it('produces zero-based, strictly monotonically increasing indices', () => {
    const segments = segmentParagraphs(
      Array.from({ length: 5 }, (_, i) => `Paragraph ${i}.`).join('\n\n'),
    );
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });
});
