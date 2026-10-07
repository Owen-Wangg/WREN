/**
 * RichPdfExtractor backed by Amazon Textract (normalized to TipTap).
 */
import type {
  RichPdfExtractOptions,
  RichPdfExtractor,
  RichPdfPageGroupExtraction,
} from './pdfExtractor.js';
import { tipTapDocToPlainText } from './textractLayoutToTipTap.js';
import {
  analyzeTextractBlocks,
  convertTextractPageGroups,
  extractWithTextract,
  type ExtractTextractInput,
} from './textractOcr.js';

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

  public async extractRich(
    bytes: Buffer,
    extractOptions: RichPdfExtractOptions = {},
  ): Promise<RichPdfPageGroupExtraction> {
    const input: ExtractTextractInput = {
      bytes,
      ...(this.options.s3Bucket && this.options.s3Key
        ? { s3Bucket: this.options.s3Bucket, s3Key: this.options.s3Key }
        : {}),
    };

    if (extractOptions.pageGroups && extractOptions.pageGroups.length > 0) {
      // One Textract run over the whole file; keep only the scanned pages.
      const blocks = await analyzeTextractBlocks(input);
      const { groups, ocrConfidence } = convertTextractPageGroups(
        blocks,
        extractOptions.pageGroups,
      );
      const content = {
        type: 'doc' as const,
        content: groups.flatMap((g) => (Array.isArray(g.content) ? g.content : [])),
      };
      return {
        text: tipTapDocToPlainText(content),
        content,
        pageGroups: groups,
        ocrConfidence,
      };
    }

    const result = await extractWithTextract(input);
    return {
      text: result.text,
      content: result.content,
      header: result.header,
      footer: result.footer,
      ocrConfidence: result.ocrConfidence,
    };
  }
}
