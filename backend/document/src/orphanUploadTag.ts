/**
 * Fail-closed clearing of the `orphan-upload=true` tag on attached uploads.
 *
 * Presigned uploads are tagged `orphan-upload=true` so the
 * `ExpireOrphanedDocumentUploads` S3 lifecycle rule deletes never-attached
 * objects after one day (see `cdk/lib/constructs/StorageResources.ts`). When a
 * document is created from an upload, that tag MUST be cleared so the retained
 * original survives.
 *
 * A silently-swallowed `DeleteObjectTagging` failure is a data-loss trap: the
 * document row commits while the object stays tagged and S3 deletes it within
 * 24h (finding S-2). This module therefore treats a tag-clear failure as
 * retryable-then-fatal — it retries with exponential backoff + jitter and, on
 * exhaustion, emits a CloudWatch EMF metric plus an error log and throws
 * {@link OrphanTagClearError} so the create path fails closed (5xx, no row).
 *
 * `s3:DeleteObjectTagging` is a distinct permission from the tag-write used at
 * upload time; failing closed here makes any policy drift observable rather
 * than silently destructive.
 */
import { DeleteObjectTaggingCommand, type S3Client } from '@aws-sdk/client-s3';

/** CloudWatch namespace/metric surfaced when a tag clear cannot be completed. */
const METRIC_NAMESPACE = 'WREN/Document';
const METRIC_NAME = 'OrphanTagClearFailure';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;

/** Thrown when the orphan-upload tag could not be cleared after all retries. */
export class OrphanTagClearError extends Error {
  /** Mapped to a 5xx by the Document handler's shared error mapper. */
  public readonly statusCode = 500;

  public constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = 'OrphanTagClearError';
  }
}

export interface ClearOrphanUploadTagDeps {
  /** S3 client (only `send` is used, so tests can inject a fake). */
  readonly client: Pick<S3Client, 'send'>;
  /** Documents bucket name; when absent the call is a no-op (config gap). */
  readonly bucket: string | undefined;
  /** Total attempts before failing closed. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Base backoff delay in ms (doubled per attempt). Defaults to 100. */
  readonly baseDelayMs?: number;
  /** Injectable sleep so tests run without real delays. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter factor in [0, 1). Defaults to `Math.random`. */
  readonly random?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Emit a CloudWatch Embedded Metric Format line (parsed from stdout logs). */
function emitFailureMetric(bucket: string, key: string, attempts: number): void {
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [[]],
          Metrics: [{ Name: METRIC_NAME, Unit: 'Count' }],
        },
      ],
    },
    [METRIC_NAME]: 1,
    bucket,
    key,
    attempts,
  };
  // EMF is emitted on stdout; CloudWatch extracts the metric automatically.
  console.log(JSON.stringify(emf));
}

/**
 * Clear the `orphan-upload` tag, retrying transient failures and failing
 * closed (throwing {@link OrphanTagClearError}) if it cannot be cleared.
 *
 * @param key    S3 object key of the attached upload.
 * @param deps   Injectable S3 client, bucket, and retry/observability knobs.
 */
export async function clearOrphanUploadTag(
  key: string,
  deps: ClearOrphanUploadTagDeps,
): Promise<void> {
  const { bucket } = deps;
  // Missing bucket env is a config gap, not a runtime tag failure — preserve
  // the historical no-op behavior rather than failing the create flow.
  if (!bucket) return;

  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await deps.client.send(
        new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }),
      );
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        // Exponential backoff with full jitter.
        const backoff = baseDelayMs * 2 ** (attempt - 1);
        await sleep(Math.floor(backoff * random()));
      }
    }
  }

  emitFailureMetric(bucket, key, maxAttempts);
  console.error('clearOrphanUploadTag: failed to clear orphan-upload tag', {
    bucket,
    key,
    attempts: maxAttempts,
    error: lastError,
  });
  throw new OrphanTagClearError(
    `Failed to clear orphan-upload tag for ${key} after ${maxAttempts} attempts`,
    lastError,
  );
}
