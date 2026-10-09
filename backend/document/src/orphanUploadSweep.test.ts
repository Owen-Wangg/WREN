import {
  DeleteObjectTaggingCommand,
  GetObjectTaggingCommand,
  ListObjectsV2Command,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import { sweepOrphanUploads } from './orphanUploadSweep';
import {
  findUnreferencedUploadKeys,
  isPresignedUploadKey,
  type UploadKeyQueryable,
} from './uploadKeyReferences';

const BUCKET = 'docs-bucket';
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const OLD = new Date(NOW - 2 * 24 * 60 * 60 * 1000);
const FRESH = new Date(NOW - 60 * 60 * 1000);

type Obj = { Key: string; LastModified: Date };

/** Fake S3 with an in-memory tag store and paged listing. */
function fakeS3(objects: Obj[], tags: Record<string, { Key: string; Value: string }[]>, pageSize = 1000) {
  const send = jest.fn(async (command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      const start = Number(command.input.ContinuationToken ?? 0);
      const page = objects.slice(start, start + pageSize);
      const next = start + pageSize;
      return {
        Contents: page,
        IsTruncated: next < objects.length,
        NextContinuationToken: next < objects.length ? String(next) : undefined,
      };
    }
    if (command instanceof GetObjectTaggingCommand) {
      return { TagSet: tags[command.input.Key!] ?? [] };
    }
    if (command instanceof PutObjectTaggingCommand) {
      tags[command.input.Key!] = [...(command.input.Tagging?.TagSet ?? [])] as {
        Key: string;
        Value: string;
      }[];
      return {};
    }
    if (command instanceof DeleteObjectTaggingCommand) {
      delete tags[command.input.Key!];
      return {};
    }
    throw new Error('unexpected command');
  });
  return { send };
}

/** Fake DB: `referenced` (mutable) is the set of keys present in draft/ingest rows. */
function fakeDb(referenced: Set<string>) {
  const query = jest.fn(async (_sql: string, params?: readonly unknown[]) => {
    const keys = (params?.[0] ?? []) as string[];
    return keys.filter((k) => referenced.has(k)).map((s3_key) => ({ s3_key }));
  });
  return { query } as unknown as UploadKeyQueryable & { query: typeof query };
}

const uploadKey = (n: number) => `documents/user-1/uploads/uuid-${n}-file.pdf`;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('isPresignedUploadKey', () => {
  it('matches only documents/<user>/uploads/<name> keys', () => {
    expect(isPresignedUploadKey('documents/u/uploads/x.pdf')).toBe(true);
    expect(isPresignedUploadKey('documents/u/other/x.pdf')).toBe(false);
    expect(isPresignedUploadKey('figures/doc/figure-1-01.png')).toBe(false);
    expect(isPresignedUploadKey('documents/u/uploads/a/b.pdf')).toBe(false);
  });
});

describe('findUnreferencedUploadKeys', () => {
  it('uses a single parameterized query and returns unreferenced keys', async () => {
    const db = fakeDb(new Set([uploadKey(1)]));
    const result = await findUnreferencedUploadKeys(db, [uploadKey(1), uploadKey(2), uploadKey(2)]);
    expect(result).toEqual([uploadKey(2)]);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([[uploadKey(1), uploadKey(2)]]);
  });

  it('skips the query for an empty key list', async () => {
    const db = fakeDb(new Set());
    expect(await findUnreferencedUploadKeys(db, [])).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('sweepOrphanUploads', () => {
  it('re-tags only aged, untagged, unreferenced upload keys', async () => {
    const objects: Obj[] = [
      { Key: uploadKey(1), LastModified: OLD }, // stranded -> re-tag
      { Key: uploadKey(2), LastModified: OLD }, // referenced -> skip
      { Key: uploadKey(3), LastModified: FRESH }, // too new -> skip
      { Key: uploadKey(4), LastModified: OLD }, // already tagged -> skip
      { Key: 'documents/user-1/other.bin', LastModified: OLD }, // not an upload key
    ];
    const tags: Record<string, { Key: string; Value: string }[]> = {
      [uploadKey(4)]: [{ Key: 'orphan-upload', Value: 'true' }],
    };
    const s3 = fakeS3(objects, tags);
    const db = fakeDb(new Set([uploadKey(2)]));

    const result = await sweepOrphanUploads({ s3, bucket: BUCKET, db, now: () => NOW });

    expect(result).toMatchObject({ scanned: 5, candidates: 2, retagged: 1, restored: 0, errors: 0, truncated: false });
    expect(tags[uploadKey(1)]).toEqual([{ Key: 'orphan-upload', Value: 'true' }]);
    expect(tags[uploadKey(2)]).toBeUndefined();
    expect(tags[uploadKey(3)]).toBeUndefined();
    const listCall = s3.send.mock.calls.find(([c]) => c instanceof ListObjectsV2Command)![0] as ListObjectsV2Command;
    expect(listCall.input.Prefix).toBe('documents/');
  });

  it('merges the orphan tag with existing tags', async () => {
    const tags: Record<string, { Key: string; Value: string }[]> = {
      [uploadKey(1)]: [{ Key: 'other', Value: 'x' }],
    };
    const s3 = fakeS3([{ Key: uploadKey(1), LastModified: OLD }], tags);
    await sweepOrphanUploads({ s3, bucket: BUCKET, db: fakeDb(new Set()), now: () => NOW });
    expect(tags[uploadKey(1)]).toEqual([
      { Key: 'other', Value: 'x' },
      { Key: 'orphan-upload', Value: 'true' },
    ]);
  });

  it('restores the original tags when an attach commits during the sweep', async () => {
    const tags: Record<string, { Key: string; Value: string }[]> = {};
    const referenced = new Set<string>();
    const s3 = fakeS3([{ Key: uploadKey(1), LastModified: OLD }], tags);
    const base = s3.send.getMockImplementation()!;
    s3.send.mockImplementation(async (command: unknown) => {
      const out = await base(command);
      // Simulate an attach committing right after the sweep writes the tag.
      if (command instanceof PutObjectTaggingCommand) referenced.add(uploadKey(1));
      return out;
    });

    const result = await sweepOrphanUploads({ s3, bucket: BUCKET, db: fakeDb(referenced), now: () => NOW });

    expect(result).toMatchObject({ retagged: 0, restored: 1 });
    // Restored to the original (empty) set via PutObjectTagging only.
    expect(tags[uploadKey(1)]).toEqual([]);
    expect(s3.send.mock.calls.some(([c]) => c instanceof DeleteObjectTaggingCommand)).toBe(false);
  });

  it('restores the original tags when the post-tag reference re-check throws', async () => {
    // Pre-check (over the full aged page) succeeds and reports the key
    // unreferenced; the post-tag re-check (single key) then throws. The sweep
    // must not leave the orphan-upload tag on a key it could not re-verify.
    const tags: Record<string, { Key: string; Value: string }[]> = {
      [uploadKey(1)]: [{ Key: 'other', Value: 'x' }],
    };
    const s3 = fakeS3([{ Key: uploadKey(1), LastModified: OLD }], tags);
    let calls = 0;
    const db = {
      query: jest.fn(async () => {
        calls += 1;
        if (calls === 1) return []; // page pre-check: unreferenced
        throw new Error('proxy connection reset'); // post-tag re-check
      }),
    } as unknown as UploadKeyQueryable;

    const result = await sweepOrphanUploads({ s3, bucket: BUCKET, db, now: () => NOW });

    expect(result).toMatchObject({ candidates: 1, retagged: 0, restored: 1, errors: 0 });
    // Original tags restored; the lifecycle-delete tag is not left behind.
    expect(tags[uploadKey(1)]).toEqual([{ Key: 'other', Value: 'x' }]);
    expect(s3.send.mock.calls.some(([c]) => c instanceof DeleteObjectTaggingCommand)).toBe(false);
  });

  it('never tags a page whose reference check fails', async () => {
    const tags: Record<string, { Key: string; Value: string }[]> = {};
    const s3 = fakeS3([{ Key: uploadKey(1), LastModified: OLD }], tags);
    const db = {
      query: jest.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as UploadKeyQueryable;

    const result = await sweepOrphanUploads({ s3, bucket: BUCKET, db, now: () => NOW });

    expect(result).toMatchObject({ retagged: 0, errors: 1 });
    expect(s3.send.mock.calls.some(([c]) => c instanceof PutObjectTaggingCommand)).toBe(false);
  });

  it('continues past a per-key S3 failure', async () => {
    const tags: Record<string, { Key: string; Value: string }[]> = {};
    const s3 = fakeS3(
      [
        { Key: uploadKey(1), LastModified: OLD },
        { Key: uploadKey(2), LastModified: OLD },
      ],
      tags,
    );
    const base = s3.send.getMockImplementation()!;
    s3.send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetObjectTaggingCommand && command.input.Key === uploadKey(1)) {
        throw new Error('throttled');
      }
      return base(command);
    });

    const result = await sweepOrphanUploads({ s3, bucket: BUCKET, db: fakeDb(new Set()), now: () => NOW });

    expect(result).toMatchObject({ candidates: 2, retagged: 1, errors: 1 });
    expect(tags[uploadKey(2)]).toEqual([{ Key: 'orphan-upload', Value: 'true' }]);
  });

  it('follows continuation tokens across pages', async () => {
    const objects = [1, 2, 3].map((n) => ({ Key: uploadKey(n), LastModified: OLD }));
    const tags: Record<string, { Key: string; Value: string }[]> = {};
    const s3 = fakeS3(objects, tags, 2);

    const result = await sweepOrphanUploads({ s3, bucket: BUCKET, db: fakeDb(new Set()), now: () => NOW });

    expect(result).toMatchObject({ scanned: 3, retagged: 3, truncated: false });
  });

  it('stops early when the time budget is exhausted', async () => {
    const s3 = fakeS3([{ Key: uploadKey(1), LastModified: OLD }], {});
    const result = await sweepOrphanUploads({
      s3,
      bucket: BUCKET,
      db: fakeDb(new Set()),
      now: () => NOW,
      remainingTimeMs: () => 1_000,
    });
    expect(result).toMatchObject({ scanned: 0, truncated: true });
    expect(s3.send).not.toHaveBeenCalled();
  });
});
