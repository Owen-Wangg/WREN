/**
 * Which presigned upload keys are still referenced by a DB row.
 *
 * An upload key under `documents/<userId>/uploads/` is "attached" once a
 * `draft.s3_key` or `document_ingest_job.s3_key` row points at it (the
 * `document` table has no key column). Re-tagging an attached key with
 * `orphan-upload=true` would let the bucket lifecycle rule
 * (`cdk/lib/constructs/StorageResources.ts`, ExpireOrphanedDocumentUploads)
 * delete a retained original, so every re-tag path checks references first.
 */

/** Minimal parameterized-query surface (satisfied by `@wren/db-node` DataAccess and tx). */
export interface UploadKeyQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/** Key prefix pattern for presigned uploads (see handlePresignUpload). */
const UPLOAD_KEY_PATTERN = /^documents\/[^/]+\/uploads\/[^/]+$/;

/** True when `key` has the shape of a presigned upload key. */
export function isPresignedUploadKey(key: string): boolean {
  return UPLOAD_KEY_PATTERN.test(key);
}

/**
 * Return the subset of `keys` that no `draft` or `document_ingest_job` row
 * references. Order follows the input; duplicates are collapsed.
 */
export async function findUnreferencedUploadKeys(
  db: UploadKeyQueryable,
  keys: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const rows = await db.query<{ s3_key: string }>(
    `SELECT s3_key FROM draft WHERE s3_key = ANY($1::text[])
     UNION
     SELECT s3_key FROM document_ingest_job WHERE s3_key = ANY($1::text[])`,
    [unique],
  );
  const referenced = new Set(rows.map((r) => r.s3_key));
  return unique.filter((k) => !referenced.has(k));
}
