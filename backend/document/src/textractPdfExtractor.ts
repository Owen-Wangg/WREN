/**
 * RichPdfExtractor backed by Amazon Textract (normalized to TipTap).
 */
import type { TipTapDoc } from '@wren/types';

import type { RichPdfExtractor } from './pdfExtractor.js';
import { extractWithTextract } from './textractOcr.js';

export class TextractPdfExtractor implements RichPdfExtractor {
  public constructor(
    private readonly options: {
      readonly s3Bucket?: string;
      readonly s3Key?: string;
    } = {},
  ) {}

  public async extract(bytes: Buffer): Promise<string> {
    const rich = await this.extractRich(bytes);
    return rich.text;
  }

  public async extractRich(bytes: Buffer): Promise<{ text: string; content: TipTapDoc }> {
    const result = await extractWithTextract({
      bytes,
      ...(this.options.s3Bucket && this.options.s3Key
        ? { s3Bucket: this.options.s3Bucket, s3Key: this.options.s3Key }
        : {}),
    });
    return { text: result.text, content: result.content };
  }
}
