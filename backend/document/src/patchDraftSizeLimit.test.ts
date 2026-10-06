/**
 * PATCH autosave size-limit HTTP mapping (same OVER_SIZE_LIMIT body as create).
 */
import { DEFAULT_SIZE_LIMIT_WORDS, effectiveCharLimit } from './sizeLimit';
import { overSizeLimitHttpResponse } from './patchDraftSizeLimit';

describe('overSizeLimitHttpResponse (PATCH autosave)', () => {
  it('returns null when the TipTap word count is at the effective limit', () => {
    expect(overSizeLimitHttpResponse(DEFAULT_SIZE_LIMIT_WORDS, null)).toBeNull();
    expect(overSizeLimitHttpResponse(100, 100)).toBeNull();
  });

  it('returns 400 OVER_SIZE_LIMIT with measured and effective counts when over', () => {
    const result = overSizeLimitHttpResponse(DEFAULT_SIZE_LIMIT_WORDS + 1, null);
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(400);
    const body = JSON.parse(result!.body) as {
      code: string;
      message: string;
      measuredWords: number;
      effectiveLimitWords: number;
    };
    expect(body.code).toBe('OVER_SIZE_LIMIT');
    expect(body.measuredWords).toBe(DEFAULT_SIZE_LIMIT_WORDS + 1);
    expect(body.effectiveLimitWords).toBe(DEFAULT_SIZE_LIMIT_WORDS);
    expect(body.message).toContain(String(DEFAULT_SIZE_LIMIT_WORDS));
  });

  it('uses the Document Type override when provided', () => {
    const result = overSizeLimitHttpResponse(51, 50);
    expect(result).not.toBeNull();
    const body = JSON.parse(result!.body) as { effectiveLimitWords: number };
    expect(body.effectiveLimitWords).toBe(50);
  });

  it('passes a within-limit word count with no char count (char ceiling not applied)', () => {
    expect(overSizeLimitHttpResponse(1, 50)).toBeNull();
  });

  it('rejects on the char ceiling when a char count is supplied (finding f-ca2d70a5)', () => {
    const charLimit = effectiveCharLimit(50);
    const result = overSizeLimitHttpResponse(1, 50, null, charLimit + 1);
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(400);
    const body = JSON.parse(result!.body) as {
      code: string;
      measuredChars: number;
      effectiveLimitChars: number;
    };
    expect(body.code).toBe('OVER_SIZE_LIMIT');
    expect(body.measuredChars).toBe(charLimit + 1);
    expect(body.effectiveLimitChars).toBe(charLimit);
  });

  it('accepts a char count exactly at the ceiling (boundary)', () => {
    const charLimit = effectiveCharLimit(50);
    expect(overSizeLimitHttpResponse(1, 50, null, charLimit)).toBeNull();
  });
});
