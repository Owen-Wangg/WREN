import { isPdfFileName, shouldIngestPdfAsync } from './ingestJob';

describe('shouldIngestPdfAsync', () => {
  it('queues PDF uploads without client TipTap', () => {
    expect(shouldIngestPdfAsync('memo.pdf', false)).toBe(true);
    expect(shouldIngestPdfAsync('Memo.PDF', false)).toBe(true);
  });

  it('keeps DOCX and client-parsed content on the sync path', () => {
    expect(shouldIngestPdfAsync('memo.docx', false)).toBe(false);
    expect(shouldIngestPdfAsync('memo.pdf', true)).toBe(false);
  });

  it('detects pdf extension', () => {
    expect(isPdfFileName('a.pdf')).toBe(true);
    expect(isPdfFileName('a.docx')).toBe(false);
  });
});
