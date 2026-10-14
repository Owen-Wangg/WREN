import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { purgeDeletedCatalogCaches } from './purgeDeletedCatalog';
import { queryKeys } from './queryKeys';

describe('purgeDeletedCatalogCaches', () => {
  it('drops cached student documents and leaves unrelated admin caches alone', async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.documents(), [{ id: 'doc-1' }]);
    client.setQueryData(queryKeys.document('doc-1'), { id: 'doc-1' });
    client.setQueryData(['document', 'doc-1'], { id: 'doc-1' });
    client.setQueryData(['document-draft', 'doc-1'], { id: 'draft-1' });
    client.setQueryData(queryKeys.writingTypes(), [{ id: 'dt-1' }]);
    client.setQueryData(['system-usage-limits'], { messageLimit: 100 });

    await purgeDeletedCatalogCaches(client);

    expect(client.getQueryData(queryKeys.documents())).toBeUndefined();
    expect(client.getQueryData(queryKeys.document('doc-1'))).toBeUndefined();
    expect(client.getQueryData(['document', 'doc-1'])).toBeUndefined();
    expect(client.getQueryData(['document-draft', 'doc-1'])).toBeUndefined();
    expect(client.getQueryData(queryKeys.writingTypes())).toBeUndefined();
    expect(client.getQueryData(['system-usage-limits'])).toEqual({ messageLimit: 100 });
  });

  it('refetches a document list that is currently on screen', async () => {
    const client = new QueryClient();
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.documents(),
      queryFn: async () => {
        calls += 1;
        return calls === 1 ? [{ id: 'doc-1' }] : [];
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    await client.fetchQuery({ queryKey: queryKeys.documents() });

    await purgeDeletedCatalogCaches(client);

    expect(client.getQueryData(queryKeys.documents())).toEqual([]);
    unsubscribe();
  });
});
