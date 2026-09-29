import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORD_LIMIT,
  parseOverSizeLimitError,
  resolveEffectiveWordLimit,
  totalDraftWordCount,
} from './wordLimit';

import type { JSONContent } from '@tiptap/react';

import { ApiError } from '@/services/apiClient';

function doc(...paragraphs: string[]): JSONContent {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : [],
    })),
  };
}

describe('resolveEffectiveWordLimit', () => {
  it('uses the Document Type override when set, even above the platform limit', () => {
    expect(resolveEffectiveWordLimit(20_000, 10_000)).toBe(20_000);
  });

  it('uses the Document Type override when set below the platform limit', () => {
    expect(resolveEffectiveWordLimit(500, 10_000)).toBe(500);
  });

  it('falls back to the platform limit when the override is null or undefined', () => {
    expect(resolveEffectiveWordLimit(null, 7_500)).toBe(7_500);
    expect(resolveEffectiveWordLimit(undefined, 7_500)).toBe(7_500);
  });

  it('falls back to the 10,000-word default when nothing is configured', () => {
    expect(resolveEffectiveWordLimit(null, undefined)).toBe(DEFAULT_WORD_LIMIT);
    expect(DEFAULT_WORD_LIMIT).toBe(10_000);
  });
});

describe('totalDraftWordCount', () => {
  it('sums body, header and footer words', () => {
    expect(totalDraftWordCount(doc('one two three'), doc('four five'), doc('six'))).toBe(6);
  });

  it('treats missing header/footer as zero', () => {
    expect(totalDraftWordCount(doc('one two', 'three'), null, undefined)).toBe(3);
  });
});

describe('parseOverSizeLimitError', () => {
  const body = {
    code: 'OVER_SIZE_LIMIT',
    message: 'This document has 12 words, which exceeds the 10-word limit.',
    measuredWords: 12,
    effectiveLimitWords: 10,
  };

  it('decodes the server OVER_SIZE_LIMIT response', () => {
    const error = new ApiError('failed', 'http', 400, body);
    expect(parseOverSizeLimitError(error)).toEqual({
      measuredWords: 12,
      effectiveLimitWords: 10,
      message: body.message,
    });
  });

  it('ignores other 400 codes', () => {
    const error = new ApiError('failed', 'http', 400, { ...body, code: 'BAD_REQUEST' });
    expect(parseOverSizeLimitError(error)).toBeNull();
  });

  it('ignores non-400 statuses and non-http errors', () => {
    expect(parseOverSizeLimitError(new ApiError('failed', 'http', 500, body))).toBeNull();
    expect(parseOverSizeLimitError(new ApiError('failed', 'network', undefined, body))).toBeNull();
    expect(parseOverSizeLimitError(new Error('boom'))).toBeNull();
    expect(parseOverSizeLimitError(undefined)).toBeNull();
  });

  it('rejects malformed bodies', () => {
    expect(parseOverSizeLimitError(new ApiError('failed', 'http', 400, 'text body'))).toBeNull();
    expect(
      parseOverSizeLimitError(
        new ApiError('failed', 'http', 400, { ...body, effectiveLimitWords: '10' }),
      ),
    ).toBeNull();
  });
});
