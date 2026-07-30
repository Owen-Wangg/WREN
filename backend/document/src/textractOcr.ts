/**
 * Amazon Textract OCR — extracts plain text (+ confidence) from PDF/image bytes
 * or an S3 object, independent of LiteParse/Tesseract.
 *
 * Sync DetectDocumentText (Bytes) covers images and single-page PDFs.
 * Multi-page PDFs use async StartDocumentTextDetection + poll when S3 is set.
 */
import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';

import type { TipTapDoc } from '@wren/types';

export type OcrEngineName = 'tesseract' | 'textract';

export interface TextractOcrResult {
  readonly text: string;
  readonly lines: readonly { readonly text: string; readonly confidence?: number }[];
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

function getClient(): TextractClient {
  return new TextractClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ca-central-1',
  });
}

function blocksToLines(blocks: readonly Block[] | undefined): {
  text: string;
  lines: { text: string; confidence?: number }[];
} {
  const lines: { text: string; confidence?: number }[] = [];
  for (const block of blocks ?? []) {
    if (block.BlockType !== 'LINE' || typeof block.Text !== 'string') continue;
    const line = block.Text.trim();
    if (!line) continue;
    lines.push({
      text: line,
      ...(typeof block.Confidence === 'number' ? { confidence: block.Confidence } : {}),
    });
  }
  return {
    text: lines.map((l) => l.text).join('\n'),
    lines,
  };
}

/** TipTap doc from OCR lines (one paragraph per non-empty line). */
export function textractLinesToTipTap(
  lines: readonly { readonly text: string }[],
): TipTapDoc {
  const paragraphs = lines
    .map((l) => l.text.trim())
    .filter(Boolean)
    .map((text) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text }],
    }));
  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
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

async function collectAsyncBlocks(
  client: TextractClient,
  jobId: string,
): Promise<Block[]> {
  const blocks: Block[] = [];
  let nextToken: string | undefined;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const page = await client.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }),
    );
    const status = page.JobStatus;
    if (status === 'FAILED') {
      throw new TextractOcrError(
        page.StatusMessage || 'Textract document text detection failed',
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
  throw new TextractOcrError('Timed out waiting for Textract job', 'TIMEOUT');
}

export interface ExtractTextractInput {
  /** Raw document bytes (sync DetectDocumentText). */
  readonly bytes?: Buffer;
  /** S3 location for async multi-page PDF. */
  readonly s3Bucket?: string;
  readonly s3Key?: string;
}

/**
 * Run Textract OCR and return normalized text + TipTap content.
 */
export async function extractWithTextract(
  input: ExtractTextractInput,
): Promise<TextractOcrResult> {
  const started = Date.now();
  const client = getClient();

  try {
    if (input.s3Bucket && input.s3Key) {
      const start = await client.send(
        new StartDocumentTextDetectionCommand({
          DocumentLocation: {
            S3Object: {
              Bucket: input.s3Bucket,
              Name: input.s3Key,
            },
          },
        }),
      );
      if (!start.JobId) {
        throw new TextractOcrError('Textract did not return a job id', 'FAILED');
      }
      const blocks = await collectAsyncBlocks(client, start.JobId);
      const { text, lines } = blocksToLines(blocks);
      return {
        text,
        lines,
        content: textractLinesToTipTap(lines),
        engine: 'textract',
        durationMs: Date.now() - started,
      };
    }

    if (!input.bytes || input.bytes.length === 0) {
      throw new TextractOcrError('No document bytes or S3 location provided', 'UNSUPPORTED');
    }

    const detected = await client.send(
      new DetectDocumentTextCommand({
        Document: { Bytes: input.bytes },
      }),
    );
    const { text, lines } = blocksToLines(detected.Blocks);
    return {
      text,
      lines,
      content: textractLinesToTipTap(lines),
      engine: 'textract',
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof TextractOcrError) throw error;
    mapAwsError(error);
  }
}

/** Resolve default OCR engine from env (runtime override may replace). */
export function resolveOcrEngine(
  override?: string | null,
): OcrEngineName | 'compare' {
  const raw = (override ?? process.env.PDF_OCR_ENGINE ?? 'tesseract')
    .trim()
    .toLowerCase();
  if (raw === 'textract' || raw === 'compare' || raw === 'tesseract') return raw;
  return 'tesseract';
}
