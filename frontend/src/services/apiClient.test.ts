import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiClient, ApiError } from './apiClient';

const payloadSchema = z.object({ id: z.string(), name: z.string() }).strict();

function mockFetchOnce(response: { body: unknown; ok: boolean; status: number }) {
  const text =
    typeof response.body === 'string'
      ? response.body
      : JSON.stringify(response.body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(text),
    } as Response),
  );
}

describe('ApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('attaches a bearer token from the Cognito token provider', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ id: '1', name: 'ok' })),
    } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      getAuthToken: () => 'jwt-token',
    });

    await client.request('/things/1', { schema: payloadSchema });

    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-token',
    );
  });

  it('validates the response body at the boundary and returns typed data', async () => {
    mockFetchOnce({ ok: true, status: 200, body: { id: '1', name: 'valid' } });

    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      getAuthToken: () => null,
    });

    const result = await client.request('/things/1', { schema: payloadSchema });
    expect(result).toEqual({ id: '1', name: 'valid' });
  });

  it('throws a validation ApiError when the payload is malformed', async () => {
    mockFetchOnce({ ok: true, status: 200, body: { id: 1, extra: true } });

    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      getAuthToken: () => null,
    });

    await expect(
      client.request('/things/1', { schema: payloadSchema }),
    ).rejects.toMatchObject({ kind: 'validation' } satisfies Partial<ApiError>);
  });

  it('throws an http ApiError for non-2xx responses', async () => {
    mockFetchOnce({ ok: false, status: 403, body: { message: 'denied' } });

    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      getAuthToken: () => null,
    });

    await expect(
      client.request('/things/1', { schema: payloadSchema }),
    ).rejects.toMatchObject({ kind: 'http', status: 403 });
  });
});
