/**
 * Unit tests for document ingestion (REQ-DOC-SUBMIT-01 criteria 1–5).
 *
 * Uses injected fake `DocxExtractor` / `PdfExtractor` implementations so
 * behavior is tested without any real file parsing — consistent with
 * `@wren/auth`'s injectable `TokenVerifier` pattern.
 */
import type { DocxExtractor } from './docxExtractor';
import {
  ACCEPTED_FILE_FORMATS,
  ingestUpload,
  type IngestionDeps,
} from './ingestion';
import { UnsupportedFileFormatError } from './errors';
import type { PdfExtractor } from './pdfExtractor';
import { segmentParagraphs } from './segmentation';

class FakeDocxExtractor implements DocxExtractor {
  public constructor(private readonly text: string) {}
  public async extract(): Promise<string> {
    return this.text;
  }
}

class FakePdfExtractor implements PdfExtractor {
  public constructor(private readonly outcome: { text: string } | { throws: Error }) {}
  public async extract(): Promise<string> {
    if ('throws' in this.outcome) throw this.outcome.throws;
    return this.outcome.text;
  }
}

function deps(overrides: Partial<IngestionDeps> = {}): IngestionDeps {
  return {
    docxExtractor: overrides.docxExtractor ?? new FakeDocxExtractor(''),
    pdfExtractor: overrides.pdfExtractor ?? new FakePdfExtractor({ text: '' }),
  };
}

describe('ingestUpload — extension acceptance/rejection (Requirement 6.1)', () => {
  it('accepts a .docx file and does not throw before extraction', async () => {
    const result = await ingestUpload(
      { kind: 'file', fileName: 'brief.docx', bytes: Buffer.from('x') },
      deps({ docxExtractor: new FakeDocxExtractor('Paragraph one.') }),
    );
    expect(result.status).toBe('success');
  });

  it('accepts a .PDF file case-insensitively', async () => {
    const result = await ingestUpload(
      { kind: 'file', fileName: 'brief.PDF', bytes: Buffer.from('x') },
      deps({ pdfExtractor: new FakePdfExtractor({ text: 'Some text.' }) }),
    );
    expect(result.status).toBe('success');
  });

  it.each(['.txt', '.rtf', '.doc', '.odt', ''])(
    'rejects a %s file with a message naming the accepted formats, before extraction',
    async (ext) => {
      const fileName = ext ? `document${ext}` : 'document-no-extension';
      const docxExtractor: DocxExtractor = {
        extract: jest.fn().mockResolvedValue('should not be called'),
      };
      const pdfExtractor: PdfExtractor = {
        extract: jest.fn().mockResolvedValue('should not be called'),
      };

      await expect(
        ingestUpload({ kind: 'file', fileName, bytes: Buffer.from('x') }, { docxExtractor, pdfExtractor }),
      ).rejects.toBeInstanceOf(UnsupportedFileFormatError);

      expect(docxExtractor.extract).not.toHaveBeenCalled();
      expect(pdfExtractor.extract).not.toHaveBeenCalled();
    },
  );

  it('rejection message names both accepted formats', async () => {
    await expect(
      ingestUpload({ kind: 'file', fileName: 'notes.txt', bytes: Buffer.from('x') }, deps()),
    ).rejects.toThrow(/\.docx.*\.pdf|\.pdf.*\.docx/);
    for (const format of ACCEPTED_FILE_FORMATS) {
      expect(format).toMatch(/^\.(docx|pdf)$/);
    }
  });
});

describe('ingestUpload — .docx extraction happy path (Requirement 6.2)', () => {
  it('segments the extracted text using segmentParagraphs', async () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    const result = await ingestUpload(
      { kind: 'file', fileName: 'brief.docx', bytes: Buffer.from('x') },
      deps({ docxExtractor: new FakeDocxExtractor(text) }),
    );
    expect(result).toEqual({ status: 'success', segments: segmentParagraphs(text) });
  });
});

describe('ingestUpload — PDF best-effort extraction and fallback (Requirement 6.1.3, 6.1.4)', () => {
  it('segments successfully extracted PDF text', async () => {
    const text = 'Alpha.\n\nBeta.';
    const result = await ingestUpload(
      { kind: 'file', fileName: 'brief.pdf', bytes: Buffer.from('x') },
      deps({ pdfExtractor: new FakePdfExtractor({ text }) }),
    );
    expect(result).toEqual({ status: 'success', segments: segmentParagraphs(text) });
  });

  it('returns a fallback result (not a thrown exception) when no recoverable text is extracted', async () => {
    const result = await ingestUpload(
      { kind: 'file', fileName: 'scanned.pdf', bytes: Buffer.from('x') },
      deps({ pdfExtractor: new FakePdfExtractor({ text: '   \n\n  ' }) }),
    );
    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.reason).toMatch(/\.docx/);
      expect(result.reason).toMatch(/paste/i);
    }
  });

  it('returns a fallback result (not a thrown exception) when extraction throws', async () => {
    const result = await ingestUpload(
      { kind: 'file', fileName: 'corrupt.pdf', bytes: Buffer.from('x') },
      deps({ pdfExtractor: new FakePdfExtractor({ throws: new Error('parse error') }) }),
    );
    expect(result.status).toBe('fallback');
  });
});

describe('ingestUpload — pasted text (Requirement 6.5)', () => {
  it('accepts pasted text directly with no extraction step', async () => {
    const pastedText = 'Pasted paragraph one.\n\nPasted paragraph two.';
    const result = await ingestUpload({ kind: 'paste', pastedText }, deps());
    expect(result).toEqual({ status: 'success', segments: segmentParagraphs(pastedText) });
  });

  it('uses the exact same segmentation function as the extracted-text path (single code path)', async () => {
    const sharedText = 'Shared paragraph one.\n\nShared paragraph two.\n\nThird.';

    const pastedResult = await ingestUpload({ kind: 'paste', pastedText: sharedText }, deps());
    const docxResult = await ingestUpload(
      { kind: 'file', fileName: 'doc.docx', bytes: Buffer.from('x') },
      deps({ docxExtractor: new FakeDocxExtractor(sharedText) }),
    );

    expect(pastedResult.status).toBe('success');
    expect(docxResult.status).toBe('success');
    if (pastedResult.status === 'success' && docxResult.status === 'success') {
      expect(pastedResult.segments).toEqual(docxResult.segments);
      expect(pastedResult.segments).toEqual(segmentParagraphs(sharedText));
    }
  });
});
