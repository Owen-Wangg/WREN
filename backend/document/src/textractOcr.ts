/**
 * Amazon Textract OCR via AnalyzeDocument (LAYOUT + TABLES).
 *
 * Sync AnalyzeDocument covers images / single-page PDFs (bytes).
 * Multi-page PDFs use async StartDocumentAnalysis + GetDocumentAnalysis when S3 is set.
 *
 * Layout elements map to TipTap headings / paragraphs / lists / tables.
 * LINE geometry soft-wrap remains as a fallback when layout blocks are absent.
 */
import {
  AnalyzeDocumentCommand,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';

import type { TipTapDoc } from '@wren/types';

import {
  textractLayoutBlocksToTipTap,
  tipTapDocToPlainText,
} from './textractLayoutToTipTap.js';
import {
  mergeTextractLinesIntoParagraphs,
  type TextractLine,
} from './textractLines.js';

export type { TextractLine } from './textractLines.js';
export {
  mergeTextractLinesIntoParagraphs,
  TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO,
  TEXTRACT_SOFT_WRAP_GAP_RATIO,
} from './textractLines.js';
export { textractLayoutBlocksToTipTap } from './textractLayoutToTipTap.js';

export type OcrEngineName = 'textract';

export interface TextractOcrResult {
  readonly text: string;
  readonly lines: readonly TextractLine[];
  readonly content: TipTapDoc;
  readonly engine: 'textract';
  readonly durationMs: number;
}

export class TextractOcrError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'UNSUPPORTED'
      | 'THROTTLED'
      | 'ACCESS_DENIED'
      | 'FAILED'
      | 'TIMEOUT',
  ) {
    super(message);
    this.name = 'TextractOcrError';
  }
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 120;

const ANALYSIS_FEATURES = ['LAYOUT', 'TABLES'] as const;

function getClient(): TextractClient {
  return new TextractClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ca-central-1',
  });
}

function blocksToLines(blocks: readonly Block[] | undefined): TextractLine[] {
  const lines: TextractLine[] = [];
  for (const block of blocks ?? []) {
    if (block.BlockType !== 'LINE' || typeof block.Text !== 'string') continue;
    const text = block.Text.trim();
    if (!text) continue;
    const box = block.Geometry?.BoundingBox;
    lines.push({
      text,
      ...(typeof block.Confidence === 'number' ? { confidence: block.Confidence } : {}),
      ...(typeof box?.Top === 'number' ? { top: box.Top } : {}),
      ...(typeof box?.Height === 'number' ? { height: box.Height } : {}),
      ...(typeof block.Page === 'number' ? { page: block.Page } : {}),
    });
  }
  return lines;
}

/** TipTap doc from Textract lines only (geometry merge) — used in unit tests / fallback. */
export function textractLinesToTipTap(lines: readonly TextractLine[]): TipTapDoc {
  const paragraphs = mergeTextractLinesIntoParagraphs(lines);
  return {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((text) => ({
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text }],
          }))
        : [{ type: 'paragraph' }],
  };
}

function mapAwsError(error: unknown): never {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  const message = error instanceof Error ? error.message : 'Textract request failed';
  if (name === 'ThrottlingException' || name === 'ProvisionedThroughputExceededException') {
    throw new TextractOcrError(message, 'THROTTLED');
  }
  if (name === 'AccessDeniedException' || name === 'UnrecognizedClientException') {
    throw new TextractOcrError(message, 'ACCESS_DENIED');
  }
  if (name === 'UnsupportedDocumentException' || name === 'InvalidParameterException') {
    throw new TextractOcrError(message, 'UNSUPPORTED');
  }
  throw new TextractOcrError(message, 'FAILED');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectAsyncAnalysisBlocks(
  client: TextractClient,
  jobId: string,
): Promise<Block[]> {
  const blocks: Block[] = [];
  let nextToken: string | undefined;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const page = await client.send(
      new GetDocumentAnalysisCommand({
        JobId: jobId,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }),
    );
    const status = page.JobStatus;
    if (status === 'FAILED') {
      throw new TextractOcrError(
        page.StatusMessage || 'Textract document analysis failed',
        'FAILED',
      );
    }
    if (status === 'PARTIAL_SUCCESS' || status === 'SUCCEEDED') {
      if (page.Blocks?.length) blocks.push(...page.Blocks);
      nextToken = page.NextToken;
      if (!nextToken && status === 'SUCCEEDED') return blocks;
      if (!nextToken && status === 'PARTIAL_SUCCESS') return blocks;
      continue;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new TextractOcrError('Timed out waiting for Textract analysis job', 'TIMEOUT');
}

export interface ExtractTextractInput {
  /** Raw document bytes (sync AnalyzeDocument). */
  readonly bytes?: Buffer;
  /** S3 location for async multi-page PDF. */
  readonly s3Bucket?: string;
  readonly s3Key?: string;
}

function resultFromBlocks(
  blocks: readonly Block[] | undefined,
  started: number,
): TextractOcrResult {
  const safeBlocks = blocks ?? [];
  const lines = blocksToLines(safeBlocks);
  const content = textractLayoutBlocksToTipTap(safeBlocks);
  const text = tipTapDocToPlainText(content) || mergeTextractLinesIntoParagraphs(lines).join('\n\n');
  return {
    text,
    lines,
    content,
    engine: 'textract',
    durationMs: Date.now() - started,
  };
}

/**
 * Run Textract LAYOUT+TABLES analysis and return normalized text + TipTap content.
 */
export async function extractWithTextract(
  input: ExtractTextractInput,
): Promise<TextractOcrResult> {
  const started = Date.now();
  const client = getClient();

  try {
    if (input.s3Bucket && input.s3Key) {
      const start = await client.send(
        new StartDocumentAnalysisCommand({
          DocumentLocation: {
            S3Object: {
              Bucket: input.s3Bucket,
              Name: input.s3Key,
            },
          },
          FeatureTypes: [...ANALYSIS_FEATURES],
        }),
      );
      if (!start.JobId) {
        throw new TextractOcrError('Textract did not return a job id', 'FAILED');
      }
      const blocks = await collectAsyncAnalysisBlocks(client, start.JobId);
      return resultFromBlocks(blocks, started);
    }

    if (!input.bytes || input.bytes.length === 0) {
      throw new TextractOcrError('No document bytes or S3 location provided', 'UNSUPPORTED');
    }

    const analyzed = await client.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: input.bytes },
        FeatureTypes: [...ANALYSIS_FEATURES],
      }),
    );
    return resultFromBlocks(analyzed.Blocks, started);
  } catch (error) {
    if (error instanceof TextractOcrError) throw error;
    mapAwsError(error);
  }
}

/** Resolve OCR engine — always returns 'textract' (Tesseract/LiteParse removed). */
export function resolveOcrEngine(
  _override?: string | null,
): OcrEngineName {
  return 'textract';
}
