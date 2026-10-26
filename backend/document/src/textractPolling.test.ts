/**
 * Async Textract polling deadline (`analyzeTextractBlocks` with an S3 source).
 */
import {
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';

import { analyzeTextractBlocks, TextractOcrError } from './textractOcr';

const S3_INPUT = { s3Bucket: 'bucket', s3Key: 'uploads/doc.pdf' } as const;
const LINE_BLOCK: Block = { BlockType: 'LINE', Text: 'Hello', Page: 1 };

/** Stubs Textract: the job reports IN_PROGRESS `inProgressPolls` times, then SUCCEEDED. */
function stubTextract(inProgressPolls: number): jest.SpyInstance {
  let polls = 0;
  return jest.spyOn(TextractClient.prototype, 'send').mockImplementation(async (command) => {
    if (command instanceof StartDocumentAnalysisCommand) return { JobId: 'job-1' };
    if (command instanceof GetDocumentAnalysisCommand) {
      polls += 1;
      return polls <= inProgressPolls
        ? { JobStatus: 'IN_PROGRESS' }
        : { JobStatus: 'SUCCEEDED', Blocks: [LINE_BLOCK] };
    }
    throw new Error('unexpected command');
  });
}

/** Runs `promise` to settlement while advancing fake time in poll-sized steps. */
async function settleWithFakeTime<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.finally(() => {
    settled = true;
  });
  // Keep the rejection observed while time advances.
  tracked.catch(() => undefined);
  while (!settled) await jest.advanceTimersByTimeAsync(1_500);
  return tracked;
}

describe('analyzeTextractBlocks async polling deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps polling past the old ~120s cap when the deadline allows it', async () => {
    // 100 polls × 1.5s ≈ 150s — the old 80-attempt cap would have timed out.
    stubTextract(100);
    const blocks = await settleWithFakeTime(
      analyzeTextractBlocks({ ...S3_INPUT, deadlineMs: Date.now() + 160_000 }),
    );
    expect(blocks).toEqual([LINE_BLOCK]);
  });

  it('throws TIMEOUT once the deadline would pass', async () => {
    stubTextract(Number.POSITIVE_INFINITY);
    const started = Date.now();
    const error = await settleWithFakeTime(
      analyzeTextractBlocks({ ...S3_INPUT, deadlineMs: started + 30_000 }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TextractOcrError);
    expect((error as TextractOcrError).code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThanOrEqual(30_000);
  });

  it('defaults to a ~120s budget when no deadline is given', async () => {
    stubTextract(Number.POSITIVE_INFINITY);
    const started = Date.now();
    const error = await settleWithFakeTime(analyzeTextractBlocks(S3_INPUT)).catch(
      (e: unknown) => e,
    );
    expect((error as TextractOcrError).code).toBe('TIMEOUT');
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(115_000);
    expect(waited).toBeLessThanOrEqual(120_000);
  });
});
