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
  // path's own post-commit tag clear.
  const stillUnreferenced = await findUnreferencedUploadKeys(db, [key]);
  if (stillUnreferenced.length === 0) {
    // PutObjectTagging with the original (possibly empty) set, so the sweep
    // role needs no s3:DeleteObjectTagging grant.
    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: { TagSet: originalTags },
      }),
    );
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
