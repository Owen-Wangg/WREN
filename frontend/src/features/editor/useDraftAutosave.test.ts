import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDraftAutosave } from './useDraftAutosave';

import type { JSONContent } from '@tiptap/react';

import { patchCurrentDraft } from '@/features/dashboard/dashboardApi';
import { ApiError } from '@/services/apiClient';

vi.mock('@/features/dashboard/dashboardApi', () => ({
  patchCurrentDraft: vi.fn(),
}));

const patchMock = vi.mocked(patchCurrentDraft);

function doc(text: string): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function overLimitError(): ApiError {
  return new ApiError('Request failed with status 400', 'http', 400, {
    code: 'OVER_SIZE_LIMIT',
    message: 'This document has 12 words, which exceeds the 10-word limit.',
    measuredWords: 12,
    effectiveLimitWords: 10,
  });
}

function renderAutosave(initial: JSONContent) {
  return renderHook(
    ({ content }: { content: JSONContent }) =>
      useDraftAutosave({ documentId: 'doc-1', content, enabled: true, baselineKey: 'draft-1' }),
    { initialProps: { content: initial } },
  );
}

/** Edit the content and let the 2.5s debounce fire the PATCH. */
async function editAndFlushDebounce(
  rerender: (props: { content: JSONContent }) => void,
  content: JSONContent,
) {
  rerender({ content });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
}

describe('useDraftAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    patchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('surfaces OVER_SIZE_LIMIT as over-limit and does not retry', async () => {
    patchMock.mockRejectedValue(overLimitError());
    const { result, rerender } = renderAutosave(doc('start'));

    await editAndFlushDebounce(rerender, doc('way too many words'));

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('over-limit');
    expect(result.current.overLimit).toEqual({
      measuredWords: 12,
      effectiveLimitWords: 10,
      message: 'This document has 12 words, which exceeds the 10-word limit.',
    });

    // Past every backoff delay (1s + 3s + 8s): still exactly one request.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  it('still retries transient failures with backoff', async () => {
    patchMock.mockRejectedValue(new ApiError('Server error', 'http', 500, undefined));
    const { result, rerender } = renderAutosave(doc('start'));

    await editAndFlushDebounce(rerender, doc('edited'));
    expect(result.current.status).toBe('error');
    expect(result.current.overLimit).toBeNull();
    expect(patchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(patchMock).toHaveBeenCalledTimes(2);
  });

  it('saves normally on the next edit and clears the over-limit state', async () => {
    patchMock.mockRejectedValueOnce(overLimitError()).mockResolvedValueOnce(undefined);
    const { result, rerender } = renderAutosave(doc('start'));

    await editAndFlushDebounce(rerender, doc('way too many words'));
    expect(result.current.status).toBe('over-limit');

    await editAndFlushDebounce(rerender, doc('short'));
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
    expect(result.current.overLimit).toBeNull();
  });

  it('Retry re-attempts the save after an over-limit rejection', async () => {
    patchMock.mockRejectedValueOnce(overLimitError()).mockResolvedValueOnce(undefined);
    const { result, rerender } = renderAutosave(doc('start'));

    await editAndFlushDebounce(rerender, doc('way too many words'));
    expect(result.current.status).toBe('over-limit');

    await act(async () => {
      result.current.retry();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });
});
