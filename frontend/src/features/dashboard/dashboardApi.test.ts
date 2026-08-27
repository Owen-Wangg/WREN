import { describe, expect, it } from 'vitest';
import type { RequestOptions } from '@/services/apiClient';
import type { HttpClient } from '@/services';
import { createDraftFromSource, fetchMetadataFields } from './dashboardApi';

function responseClient(response: unknown, paths: string[] = []): HttpClient {
  return {
    async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
      paths.push(path);
      return options.schema ? options.schema.parse(response) : response as T;
    },
  };
}

describe('dashboard API metadata and ingest boundaries', () => {
  it('requests and validates the selected document type metadata fields', async () => {
    const paths: string[] = [];
    const client = responseClient([
      { id: 'field-1', documentTypeId: 'type-1', label: 'Topic', required: true },
    ], paths);

    await expect(fetchMetadataFields(client, 'type-1')).resolves.toHaveLength(1);
    expect(paths).toEqual(['/v1/document-types/type-1/metadata-fields']);
  });

  it('maps an enqueue failure to a visible failed-ingest result', async () => {
    const client = responseClient({
      ingestStatus: 'failed',
      jobId: 'job-1',
      documentId: 'doc-1',
      errorMessage: 'Processing could not be queued.',
    });

    await expect(
      createDraftFromSource(client, 'doc-1', { kind: 'file', key: 'documents/user/file.pdf' }),
    ).resolves.toEqual({
      kind: 'ingestFailed',
      jobId: 'job-1',
      documentId: 'doc-1',
      message: 'Processing could not be queued.',
    });
  });
});