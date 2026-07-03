import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { writingTypeSchema } from '@wren/types';

import { MockApiClient } from './mockApi';

describe('MockApiClient', () => {
  it('returns shared-type-shaped fixtures validated against their schema', async () => {
    const client = new MockApiClient();
    const result = await client.request('/writing-types', {
      schema: z.array(writingTypeSchema),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Legal Memo');
  });

  it('throws a 404 ApiError for an unregistered route', async () => {
    const client = new MockApiClient();

    await expect(
      client.request('/unknown', { schema: z.unknown() }),
    ).rejects.toMatchObject({ kind: 'http', status: 404 });
  });
});
