import { describe, expect, it } from 'vitest';
import type { RequestOptions } from '@/services/apiClient';
import type { HttpClient } from '@/services';
import { createDraftFromSource, fetchMetadataFields, fetchOrganizations } from './dashboardApi';

function responseClient(response: unknown, paths: string[] = []): HttpClient {
  return {
    async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
      paths.push(path);
      return options.schema ? options.schema.parse(response) : response as T;
    },
  };
}

describe('dashboard API metadata and ingest boundaries', () => {
  it('preserves discoverable and hidden departments in the shared projection', async () => {
    const paths: string[] = [];
    const client = responseClient([
      { id: 'department-visible', name: 'Visible', viewerCanDiscover: true },
      { id: 'department-hidden', name: 'Hidden', viewerCanDiscover: false },
    ], paths);

    await expect(fetchOrganizations(client)).resolves.toEqual([
      {
        id: 'department-visible',
        name: 'Visible',
        accessState: 'OPEN',
        viewerCanDiscover: true,
      },
      {
        id: 'department-hidden',
        name: 'Hidden',
        accessState: 'OPEN',
        viewerCanDiscover: false,
      },
    ]);
    expect(paths).toEqual(['/v1/departments']);
  });

  it('rejects a department response without an explicit discovery decision', async () => {
    const client = responseClient([{ id: 'department-1', name: 'Incomplete' }]);

    await expect(fetchOrganizations(client)).rejects.toThrow();
  });

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