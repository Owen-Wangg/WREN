/**
 * Select PDF extractor by OCR engine (Tesseract/LiteParse vs Textract).
 */
import { LiteParsePdfExtractor, type RichPdfExtractor } from './pdfExtractor.js';
import { resolveOcrEngine, type OcrEngineName } from './textractOcr.js';
import { TextractPdfExtractor } from './textractPdfExtractor.js';

export interface PdfExtractorOptions {
  readonly engine?: string | null;
  readonly s3Bucket?: string;
  readonly s3Key?: string;
}

export function createPdfExtractor(options: PdfExtractorOptions = {}): {
  extractor: RichPdfExtractor;
  engine: OcrEngineName | 'compare';
} {
  const engine = resolveOcrEngine(options.engine);
  if (engine === 'textract' || engine === 'compare') {
    // Compare mode still needs a primary extractor for draft creation;
    // the worker runs both engines separately when engine === 'compare'.
    return {
      extractor: new TextractPdfExtractor({
        s3Bucket: options.s3Bucket,
        s3Key: options.s3Key,
      }),
      engine,
    };
  }
  return { extractor: new LiteParsePdfExtractor(), engine: 'tesseract' };
}
