import { isPdfFileName, shouldIngestPdfAsync } from './ingestJob';

describe('shouldIngestPdfAsync', () => {
  it('always queues PDF uploads off the request path', () => {
    expect(shouldIngestPdfAsync('memo.pdf')).toBe(true);
    expect(shouldIngestPdfAsync('Memo.PDF')).toBe(true);
  });

  it('keeps DOCX on the sync path', () => {
    expect(shouldIngestPdfAsync('memo.docx')).toBe(false);
  });

  it('detects pdf extension', () => {
    expect(isPdfFileName('a.pdf')).toBe(true);
    expect(isPdfFileName('a.docx')).toBe(false);
  });
});
