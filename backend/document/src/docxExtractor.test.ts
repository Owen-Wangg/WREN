/**
 * Unit tests for the `.docx` extraction adapter (REQ-DOC-SUBMIT-01 criterion 2).
 *
 * `MammothDocxExtractor` is a thin adapter over `mammoth.extractRawText`; these
 * tests verify the plumbing (buffer in, `result.value` out) by mocking the
 * `mammoth` module, keeping the test independent of building a real `.docx`
 * binary fixture. Behavioral coverage of extraction feeding segmentation lives
 * in `ingestion.test.ts` via the injectable `DocxExtractor` port (a fake there
 * stands in for this adapter, per the port/adapter design).
 */
import mammoth from 'mammoth';

import { MammothDocxExtractor } from './docxExtractor';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));

describe('MammothDocxExtractor', () => {
  it('delegates to mammoth.extractRawText with the given buffer and returns its value', async () => {
    const mockExtractRawText = mammoth.extractRawText as jest.Mock;
    mockExtractRawText.mockResolvedValue({ value: 'First paragraph.\n\nSecond paragraph.' });

    const bytes = Buffer.from('fake docx bytes');
    const extractor = new MammothDocxExtractor();
    const text = await extractor.extract(bytes);

    expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: bytes });
    expect(text).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('propagates a rejection from mammoth.extractRawText', async () => {
    const mockExtractRawText = mammoth.extractRawText as jest.Mock;
    mockExtractRawText.mockRejectedValue(new Error('corrupt docx'));

    const extractor = new MammothDocxExtractor();
    await expect(extractor.extract(Buffer.from('bad'))).rejects.toThrow('corrupt docx');
  });
});
