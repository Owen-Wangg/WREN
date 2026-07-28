/**
 * PDF extraction via LiteParse (Apache-2.0): text + TipTap structure.
 *
 * - Digital PDFs: native text layer → spatial items → TipTap heuristics.
 * - Scanned PDFs: OCR when enabled AND tessdata language packs are present
 *   (5C: built-in Tesseract; optional PDF_OCR_SERVER_URL for an external engine).
 *
 * Env:
 *   PDF_OCR_ENABLED   — default true; set "false" to skip OCR
 *   PDF_OCR_LANGUAGE  — Tesseract langs, e.g. "eng" or "eng+fra" (must match
 *                       `*.traineddata` files under tessdata)
 *   TESSDATA_PREFIX   — directory containing traineddata (Lambda: /var/task/tessdata)
 *   PDF_OCR_SERVER_URL — optional external OCR HTTP service
 *
 * See module history in git for the ESM-from-CJS `importEsm` rationale.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
let loggedOcrConfig = false;

function resolveTessdataPath(): string | undefined {
  if (process.env.TESSDATA_PREFIX && process.env.TESSDATA_PREFIX.trim()) {
    return process.env.TESSDATA_PREFIX.trim();
  }
  // Bundled next to the Lambda handler via CDK; in repo / Jest, tessdata lives
  // one level above `src/` (`backend/document/tessdata`).
  const candidates = [join(__dirname, 'tessdata'), join(__dirname, '..', 'tessdata')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

/** Tesseract accepts "eng" or "eng+fra"; each segment needs a traineddata file. */
function tessdataLanguagesReady(tessdataPath: string, language: string): boolean {
  const langs = language
    .split(/[+,\s]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (langs.length === 0) return false;
  return langs.every((lang) => existsSync(join(tessdataPath, `${lang}.traineddata`)));
}

function buildParserConfig(): Partial<LiteParseConfig> {
  const wantOcr = (process.env.PDF_OCR_ENABLED ?? 'true').toLowerCase() !== 'false';
  const tessdataPath = resolveTessdataPath();
  const ocrLanguage = process.env.PDF_OCR_LANGUAGE?.trim() || 'eng';
  const ocrServerUrl = process.env.PDF_OCR_SERVER_URL?.trim() || undefined;

  let ocrEnabled = wantOcr;
  let ocrSkipReason: string | undefined;

  if (wantOcr && !ocrServerUrl) {
    if (!tessdataPath) {
      ocrEnabled = false;
      ocrSkipReason = 'TESSDATA_PREFIX / bundled tessdata path missing';
    } else if (!tessdataLanguagesReady(tessdataPath, ocrLanguage)) {
      ocrEnabled = false;
      ocrSkipReason = `missing traineddata for PDF_OCR_LANGUAGE="${ocrLanguage}" under ${tessdataPath}`;
    }
  }

  if (!loggedOcrConfig) {
    loggedOcrConfig = true;
    // eslint-disable-next-line no-console
    console.info('[pdfExtractor] OCR config', {
      requested: wantOcr,
      enabled: ocrEnabled,
      language: ocrLanguage,
      tessdataPath: tessdataPath ?? null,
      ocrServerUrl: ocrServerUrl ? '(set)' : null,
      ...(ocrSkipReason ? { skipReason: ocrSkipReason } : {}),
    });
  }

  return {
    ocrEnabled,
    outputFormat: 'json',
    ocrLanguage,
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
  loggedOcrConfig = false;
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
