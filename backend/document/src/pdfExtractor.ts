/**
 * PDF extraction via LiteParse (Apache-2.0): text + TipTap structure.
 *
 * - Digital PDFs: native text layer → spatial items → TipTap heuristics.
 * - Scanned PDFs: OCR enabled when TESSDATA_PREFIX / tessdataPath is set
 *   (5C: built-in Tesseract; optional OCR_SERVER_URL hook for a later engine).
 *
 * See module history in git for the ESM-from-CJS `importEsm` rationale.
 */
import type { TipTapDoc } from '@wren/types';

import { spatialPagesToTipTap } from './pdfToTipTap';

/** Best-effort PDF text extraction. Implementations MAY throw on failure. */
export interface PdfExtractor {
  extract(bytes: Buffer): Promise<string>;
}

/** Rich extraction: plain text + TipTap JSON for draft.content. */
export interface RichPdfExtractor extends PdfExtractor {
  extractRich(bytes: Buffer): Promise<{ text: string; content: TipTapDoc }>;
}

interface LiteParseTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
}

interface LiteParsePage {
  textItems?: LiteParseTextItem[];
}

interface LiteParseResult {
  text: string;
  pages?: LiteParsePage[];
}

interface LiteParseConfig {
  ocrEnabled?: boolean;
  ocrServerUrl?: string;
  ocrServerHeaders?: Record<string, string>;
  tessdataPath?: string;
  ocrLanguage?: string;
  outputFormat?: 'json' | 'text' | 'markdown';
  ocrFailureFatal?: boolean;
}

interface LiteParseModule {
  LiteParse: new (config?: Partial<LiteParseConfig>) => {
    parse(input: Buffer | Uint8Array): Promise<LiteParseResult>;
  };
}

const importEsm = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<unknown>;

let cachedParser: InstanceType<LiteParseModule['LiteParse']> | undefined;

function resolveTessdataPath(): string | undefined {
  if (process.env.TESSDATA_PREFIX && process.env.TESSDATA_PREFIX.trim()) {
    return process.env.TESSDATA_PREFIX.trim();
  }
  // Bundled next to the Lambda handler when CDK copies tessdata/.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    return path.join(__dirname, 'tessdata');
  } catch {
    return undefined;
  }
}

function buildParserConfig(): Partial<LiteParseConfig> {
  const ocrEnabled =
    (process.env.PDF_OCR_ENABLED ?? 'true').toLowerCase() !== 'false';
  const tessdataPath = resolveTessdataPath();
  const ocrServerUrl = process.env.PDF_OCR_SERVER_URL?.trim() || undefined;

  return {
    ocrEnabled,
    outputFormat: 'json',
    ocrLanguage: process.env.PDF_OCR_LANGUAGE?.trim() || 'eng',
    // Prefer partial results over hard fail when OCR struggles on mixed pages.
    ocrFailureFatal: false,
    ...(tessdataPath ? { tessdataPath } : {}),
    // 5C hook: point at an external OCR HTTP service later without code changes.
    ...(ocrServerUrl ? { ocrServerUrl } : {}),
  };
}

async function getParser(): Promise<InstanceType<LiteParseModule['LiteParse']>> {
  if (!cachedParser) {
    const mod = (await importEsm('@llamaindex/liteparse')) as LiteParseModule;
    cachedParser = new mod.LiteParse(buildParserConfig());
  }
  return cachedParser;
}

/** Reset cached parser (tests / config changes). */
export function resetLiteParseCache(): void {
  cachedParser = undefined;
}

/**
 * LiteParse-backed extractor with OCR + TipTap mapping.
 */
export class LiteParsePdfExtractor implements RichPdfExtractor {
  public async extract(bytes: Buffer): Promise<string> {
    const rich = await this.extractRich(bytes);
    return rich.text;
  }

  public async extractRich(bytes: Buffer): Promise<{ text: string; content: TipTapDoc }> {
    const parser = await getParser();
    const result = await parser.parse(bytes);
    const text = typeof result.text === 'string' ? result.text : '';
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const content = spatialPagesToTipTap(
      pages.map((p) => ({
        textItems: (p.textItems ?? []).map((item) => ({
          text: item.text ?? '',
          x: item.x ?? 0,
          y: item.y ?? 0,
          width: item.width ?? 0,
          height: item.height ?? 0,
          fontName: item.fontName,
          fontSize: item.fontSize,
        })),
      })),
    );
    return { text, content };
  }
}
