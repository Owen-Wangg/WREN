/**
 * EventBridge-scheduled entry point for the orphan-upload reconciliation sweep
 * (see `orphanUploadSweep.ts`). Wired in `cdk/lib/stacks/ComputeStack.ts`.
 */
import type { Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { freezeEventLoopOnReturn, getDataAccess } from '@wren/db-node';
import { sweepOrphanUploads, type OrphanUploadSweepResult } from './orphanUploadSweep.js';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ca-central-1' });

export const handler = async (
  _event: unknown,
  context?: Context,
): Promise<OrphanUploadSweepResult> => {
  freezeEventLoopOnReturn(context);
  const bucket = process.env.DOCUMENTS_BUCKET_NAME;
  if (!bucket) {
    throw new Error('DOCUMENTS_BUCKET_NAME environment variable is required.');
  }
  const db = await getDataAccess();
  return sweepOrphanUploads({
    s3: s3Client,
    bucket,
    db,
    remainingTimeMs: context ? () => context.getRemainingTimeInMillis() : undefined,
  });
};
