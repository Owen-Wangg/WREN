/**
 * PATCH autosave size-limit HTTP mapping (same OVER_SIZE_LIMIT body as create).
 */
import { DEFAULT_SIZE_LIMIT_WORDS } from './sizeLimit';
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
});
