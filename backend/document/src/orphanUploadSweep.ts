/**
 * Scheduled reconciliation sweep for stranded presigned uploads.
 *
 * The `ExpireOrphanedDocumentUploads` lifecycle rule
 * (`cdk/lib/constructs/StorageResources.ts`) only selects objects tagged
 * `orphan-upload=true`. If an attach path clears that tag and then fails
 * without restoring it (or the best-effort re-tag itself fails), the object
 * is untagged, referenced by no row, and would otherwise live forever.
 *
 * This sweep lists current object versions under `documents/`, keeps only
 * presigned upload keys older than `minAgeMs`, drops any key still referenced
 * by a `draft` / `document_ingest_job` row, and re-applies the orphan tag to
 * the rest so the lifecycle rule reclaims them. After tagging, references are
 * re-checked and the original tag set is restored if an attach committed in
 * the meantime.
 */
import {
  GetObjectTaggingCommand,
  ListObjectsV2Command,
  PutObjectTaggingCommand,
  type S3Client,
  type Tag,
} from '@aws-sdk/client-s3';
import {
  findUnreferencedUploadKeys,
  isPresignedUploadKey,
  type UploadKeyQueryable,
} from './uploadKeyReferences.js';

export const ORPHAN_TAG_KEY = 'orphan-upload';
export const ORPHAN_TAG_VALUE = 'true';

const LIST_PREFIX = 'documents/';
const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Stop starting new pages when less than this much invocation time remains. */
const DEFAULT_TIME_RESERVE_MS = 30_000;

const METRIC_NAMESPACE = 'WREN/Document';

export interface OrphanUploadSweepDeps {
  /** S3 client (only `send` is used, so tests can inject a fake). */
  readonly s3: Pick<S3Client, 'send'>;
  /** Documents bucket name. */
  readonly bucket: string;
  /** Parameterized DB access for the reference check. */
  readonly db: UploadKeyQueryable;
  /** Clock (ms since epoch). Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Only objects last modified at least this long ago are considered. Default 24h. */
  readonly minAgeMs?: number;
  /** Remaining invocation time in ms (Lambda context). Omit to run unbounded. */
  readonly remainingTimeMs?: () => number;
  /** Time reserve before stopping. Default 30s. */
  readonly timeReserveMs?: number;
  /** Total attempts for the fail-safe tag restore. Default 4. */
  readonly restoreMaxAttempts?: number;
  /** Base backoff delay in ms for the restore (doubled per attempt). Default 200. */
  readonly restoreBaseDelayMs?: number;
  /** Injectable sleep so tests run without real delays. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter factor in [0, 1). Defaults to `Math.random`. */
  readonly random?: () => number;
}

const DEFAULT_RESTORE_MAX_ATTEMPTS = 4;
const DEFAULT_RESTORE_BASE_DELAY_MS = 200;
const RESTORE_FAILURE_METRIC = 'OrphanSweepRestoreFailure';

/** Thrown when the fail-safe tag restore could not be completed after all retries. */
export class OrphanTagRestoreError extends Error {
  public constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = 'OrphanTagRestoreError';
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Emit a dedicated EMF metric when a restore is exhausted. A live upload is
 * left carrying the lifecycle-delete tag, so this is alarm-worthy on its own
 * (it must not be lost in the aggregate OrphanSweepErrors count).
 */
function emitRestoreFailureMetric(bucket: string, key: string, attempts: number): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: METRIC_NAMESPACE,
            Dimensions: [[]],
            Metrics: [{ Name: RESTORE_FAILURE_METRIC, Unit: 'Count' }],
          },
        ],
      },
      [RESTORE_FAILURE_METRIC]: 1,
      bucket,
      key,
      attempts,
    }),
  );
}

/**
 * Put the original tag set back, retrying transient S3 failures with
 * exponential backoff + full jitter (f-cfa9f076). A single failed restore
 * would leave `orphan-upload=true` on a referenced key, and later sweeps never
 * revisit referenced keys, so the lifecycle rule would delete a live upload.
 * Uses PutObjectTagging (not DeleteObjectTagging) so unrelated tags survive
 * and the sweep role needs no s3:DeleteObjectTagging grant.
 */
async function restoreOriginalTags(
  deps: OrphanUploadSweepDeps,
  key: string,
  originalTags: Tag[],
): Promise<void> {
  const maxAttempts = deps.restoreMaxAttempts ?? DEFAULT_RESTORE_MAX_ATTEMPTS;
  const baseDelayMs = deps.restoreBaseDelayMs ?? DEFAULT_RESTORE_BASE_DELAY_MS;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await deps.s3.send(
        new PutObjectTaggingCommand({
          Bucket: deps.bucket,
          Key: key,
          Tagging: { TagSet: originalTags },
        }),
      );
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(Math.floor(baseDelayMs * 2 ** (attempt - 1) * random()));
      }
    }
  }

  emitRestoreFailureMetric(deps.bucket, key, maxAttempts);
  console.error('orphanUploadSweep: failed to restore tags; live upload may be expired', {
    bucket: deps.bucket,
    key,
    attempts: maxAttempts,
    error: lastError,
  });
  throw new OrphanTagRestoreError(
    `Failed to restore original tags for ${key} after ${maxAttempts} attempts`,
    lastError,
  );
}

export interface OrphanUploadSweepResult {
  /** Objects listed under the prefix. */
  scanned: number;
  /** Aged, unreferenced upload keys inspected for tags. */
  candidates: number;
  /** Keys newly tagged for lifecycle expiry. */
  retagged: number;
  /** Keys tagged then restored because an attach committed concurrently. */
  restored: number;
  /** Per-key S3/DB failures (the sweep continues past them). */
  errors: number;
  /** True when the sweep stopped early on the time budget. */
  truncated: boolean;
}

function hasOrphanTag(tags: readonly Tag[]): boolean {
  return tags.some((t) => t.Key === ORPHAN_TAG_KEY && t.Value === ORPHAN_TAG_VALUE);
}

/** Emit a CloudWatch Embedded Metric Format line (parsed from stdout logs). */
function emitSweepMetrics(result: OrphanUploadSweepResult): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: METRIC_NAMESPACE,
            Dimensions: [[]],
            Metrics: [
              { Name: 'OrphanSweepScanned', Unit: 'Count' },
              { Name: 'OrphanSweepRetagged', Unit: 'Count' },
              { Name: 'OrphanSweepErrors', Unit: 'Count' },
            ],
          },
        ],
      },
      OrphanSweepScanned: result.scanned,
      OrphanSweepRetagged: result.retagged,
      OrphanSweepErrors: result.errors,
      candidates: result.candidates,
      restored: result.restored,
      truncated: result.truncated,
    }),
  );
}

/** Tag one unreferenced key; returns what happened. */
async function retagKey(
  deps: OrphanUploadSweepDeps,
  key: string,
): Promise<'retagged' | 'already-tagged' | 'restored'> {
  const { s3, bucket, db } = deps;
  const current = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
  const originalTags = current.TagSet ?? [];
  if (hasOrphanTag(originalTags)) return 'already-tagged';

  // PutObjectTagging replaces the whole set, so merge with existing tags.
  await s3.send(
    new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: {
        TagSet: [
          ...originalTags.filter((t) => t.Key !== ORPHAN_TAG_KEY),
          { Key: ORPHAN_TAG_KEY, Value: ORPHAN_TAG_VALUE },
        ],
      },
    }),
  );

  // Race with an attach that committed between the reference check and the
  // tag write: if the key is referenced now, put the original tag set back.
  // An attach that commits after this re-check is covered by the attach
  // path's own post-commit tag clear. If the re-check itself fails we cannot
  // prove the key is still unreferenced, so we restore the original tags
  // (fail-safe), matching tagOrphanUploadForExpiry in lambda-handler.ts —
  // never leave a lifecycle-delete tag on a key we could not verify.
  let stillUnreferenced: string[];
  try {
    stillUnreferenced = await findUnreferencedUploadKeys(db, [key]);
  } catch (err) {
    console.warn('orphanUploadSweep: post-tag reference check failed; restoring tags', {
      key,
      error: err,
    });
    stillUnreferenced = [];
  }
  if (stillUnreferenced.length === 0) {
    await restoreOriginalTags(deps, key, originalTags);
    return 'restored';
  }
  return 'retagged';
}

/** Run one sweep over the documents bucket. */
export async function sweepOrphanUploads(
  deps: OrphanUploadSweepDeps,
): Promise<OrphanUploadSweepResult> {
  const now = deps.now ?? Date.now;
  const minAgeMs = deps.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const timeReserveMs = deps.timeReserveMs ?? DEFAULT_TIME_RESERVE_MS;
  const cutoff = now() - minAgeMs;

  const result: OrphanUploadSweepResult = {
    scanned: 0,
    candidates: 0,
    retagged: 0,
    restored: 0,
    errors: 0,
    truncated: false,
  };

  const outOfTime = (): boolean =>
    deps.remainingTimeMs !== undefined && deps.remainingTimeMs() < timeReserveMs;

  let continuationToken: string | undefined;
  do {
    if (outOfTime()) {
      result.truncated = true;
      break;
    }
    const page = await deps.s3.send(
      new ListObjectsV2Command({
        Bucket: deps.bucket,
        Prefix: LIST_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = page.Contents ?? [];
    result.scanned += objects.length;

    const aged = objects
      .filter(
        (o) =>
          typeof o.Key === 'string' &&
          isPresignedUploadKey(o.Key) &&
          o.LastModified instanceof Date &&
          o.LastModified.getTime() <= cutoff,
      )
      .map((o) => o.Key as string);

    let unreferenced: string[] = [];
    if (aged.length > 0) {
      try {
        unreferenced = await findUnreferencedUploadKeys(deps.db, aged);
      } catch (err) {
        // Fail safe: never tag keys we could not prove are unreferenced.
        result.errors += aged.length;
        console.error('orphanUploadSweep: reference check failed for page', { error: err });
      }
    }

    for (const key of unreferenced) {
      result.candidates += 1;
      try {
        const outcome = await retagKey(deps, key);
        if (outcome === 'retagged') result.retagged += 1;
        if (outcome === 'restored') result.restored += 1;
      } catch (err) {
        result.errors += 1;
        console.error('orphanUploadSweep: failed to process key', { key, error: err });
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  emitSweepMetrics(result);
  return result;
}
