import { DeleteObjectTaggingCommand } from '@aws-sdk/client-s3';
import {
  clearOrphanUploadTag,
  OrphanTagClearError,
  type ClearOrphanUploadTagDeps,
} from './orphanUploadTag';

const BUCKET = 'wren-documents';
const KEY = 'documents/user-1/upload.pdf';

/** Build deps with a fake `send` and no real delays/jitter. */
function makeDeps(
  send: jest.Mock,
  overrides: Partial<ClearOrphanUploadTagDeps> = {},
): ClearOrphanUploadTagDeps {
  return {
    client: { send } as unknown as ClearOrphanUploadTagDeps['client'],
    bucket: BUCKET,
    maxAttempts: 3,
    baseDelayMs: 1,
    sleep: jest.fn().mockResolvedValue(undefined),
    random: () => 0,
    ...overrides,
  };
}

describe('clearOrphanUploadTag — fail-closed orphan tag clearing (S-2)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears the tag on the first attempt', async () => {
    const send = jest.fn().mockResolvedValue({});

    await expect(clearOrphanUploadTag(KEY, makeDeps(send))).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectTaggingCommand);
    expect(command.input).toEqual({ Bucket: BUCKET, Key: KEY });
  });

  it('retries transient failures then succeeds', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValueOnce({});

    await expect(clearOrphanUploadTag(KEY, makeDeps(send))).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fails closed after exhausting retries: throws, logs, and emits a metric', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const send = jest.fn().mockRejectedValue(new Error('access denied'));

    await expect(clearOrphanUploadTag(KEY, makeDeps(send))).rejects.toBeInstanceOf(
      OrphanTagClearError,
    );

    expect(send).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // An EMF metric line for the failure is emitted on stdout.
    expect(logSpy).toHaveBeenCalledTimes(1);
    const emf = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(emf.OrphanTagClearFailure).toBe(1);
    expect(emf._aws.CloudWatchMetrics[0].Namespace).toBe('WREN/Document');
    expect(emf._aws.CloudWatchMetrics[0].Metrics[0].Name).toBe('OrphanTagClearFailure');
    expect(emf.bucket).toBe(BUCKET);
    expect(emf.key).toBe(KEY);
  });

  it('carries the last error and a 500 status on the thrown error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const cause = new Error('access denied');
    const send = jest.fn().mockRejectedValue(cause);

    await expect(clearOrphanUploadTag(KEY, makeDeps(send))).rejects.toMatchObject({
      statusCode: 500,
      cause,
    });
  });

  it('is a no-op when the bucket is not configured', async () => {
    const send = jest.fn();

    await expect(
      clearOrphanUploadTag(KEY, makeDeps(send, { bucket: undefined })),
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
  });
});
