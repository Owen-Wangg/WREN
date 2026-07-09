/**
 * Unit tests for effective size-limit resolution and enforcement
 * (REQ-DOC-SIZE-01 / Requirements 7.1, 7.2, 7.3, 7.4; design Property 4 targets
 * this module).
 *
 * Covers: word-count measurement; default limit when no override; Document Type
 * override winning over the platform default; the exactly-at-limit boundary
 * (accepted — Requirement 7.2 rejects only when the document *exceeds* the
 * limit); and over-limit rejection returning both the effective limit and the
 * measured size (Requirement 7.2).
 */
import type { Segment } from '@wren/types';

import {
  DEFAULT_SIZE_LIMIT_WORDS,
  countWords,
  countWordsInText,
  enforceSizeLimit,
  enforceSizeLimitForWordCount,
  resolveEffectiveSizeLimitWords,
  type SizeLimitOverrides,
} from './sizeLimit';

const NO_OVERRIDES: SizeLimitOverrides = {
  documentTypeSizeLimitWords: null,
};

/** Build ordered segments from paragraph strings. */
function segmentsOf(...paragraphs: string[]): Segment[] {
  return paragraphs.map((text, index) => ({ index, text }));
}

/** A single segment whose text is `wordCount` space-separated words. */
function segmentWithWords(wordCount: number): Segment[] {
  return segmentsOf(Array.from({ length: wordCount }, (_, i) => `w${i}`).join(' '));
}

describe('countWordsInText', () => {
  it('counts maximal non-whitespace runs', () => {
    expect(countWordsInText('one two three')).toBe(3);
  });

  it('collapses runs of mixed whitespace (spaces, tabs, newlines) between words', () => {
    expect(countWordsInText('one \t two\n\nthree   four')).toBe(4);
  });

  it('returns 0 for empty and whitespace-only text', () => {
    expect(countWordsInText('')).toBe(0);
    expect(countWordsInText('   \n\t  ')).toBe(0);
  });

  it('ignores leading and trailing whitespace', () => {
    expect(countWordsInText('   padded words   ')).toBe(2);
  });
});

describe('countWords', () => {
  it('sums the word counts across all paragraph segments', () => {
    const segments = segmentsOf('alpha beta', 'gamma', 'delta epsilon zeta');
    expect(countWords(segments)).toBe(6);
  });

  it('returns 0 for an empty document (no segments)', () => {
    expect(countWords([])).toBe(0);
  });
});

describe('resolveEffectiveSizeLimitWords', () => {
  it('uses the platform default when no override is configured', () => {
    expect(resolveEffectiveSizeLimitWords(NO_OVERRIDES)).toBe(DEFAULT_SIZE_LIMIT_WORDS);
    expect(DEFAULT_SIZE_LIMIT_WORDS).toBe(10_000);
  });

  it('uses the Document Type override when set (Requirement 7.4)', () => {
    expect(
      resolveEffectiveSizeLimitWords({
        documentTypeSizeLimitWords: 5_000,
      }),
    ).toBe(5_000);
  });

  it('uses the Document Type override over the default', () => {
    expect(
      resolveEffectiveSizeLimitWords({
        documentTypeSizeLimitWords: 3_000,
      }),
    ).toBe(3_000);
  });
});

describe('enforceSizeLimitForWordCount', () => {
  it('accepts a document exactly at the effective limit (boundary — Requirement 7.2)', () => {
    const result = enforceSizeLimitForWordCount(DEFAULT_SIZE_LIMIT_WORDS, NO_OVERRIDES);
    expect(result).toEqual({
      status: 'within-limit',
      effectiveLimitWords: DEFAULT_SIZE_LIMIT_WORDS,
      measuredWords: DEFAULT_SIZE_LIMIT_WORDS,
    });
  });

  it('accepts a document one word under the effective limit', () => {
    const result = enforceSizeLimitForWordCount(DEFAULT_SIZE_LIMIT_WORDS - 1, NO_OVERRIDES);
    expect(result.status).toBe('within-limit');
  });

  it('rejects a document one word over the effective limit, returning both numbers (Requirement 7.2)', () => {
    const result = enforceSizeLimitForWordCount(DEFAULT_SIZE_LIMIT_WORDS + 1, NO_OVERRIDES);
    expect(result.status).toBe('over-limit');
    expect(result.effectiveLimitWords).toBe(DEFAULT_SIZE_LIMIT_WORDS);
    expect(result.measuredWords).toBe(DEFAULT_SIZE_LIMIT_WORDS + 1);
    if (result.status === 'over-limit') {
      expect(result.message).toContain(String(DEFAULT_SIZE_LIMIT_WORDS));
      expect(result.message).toContain(String(DEFAULT_SIZE_LIMIT_WORDS + 1));
    }
  });

  it('enforces the Document Type override boundary', () => {
    const overrides: SizeLimitOverrides = {
      documentTypeSizeLimitWords: 100,
    };
    expect(enforceSizeLimitForWordCount(100, overrides).status).toBe('within-limit');
    expect(enforceSizeLimitForWordCount(101, overrides).status).toBe('over-limit');
  });
});

describe('enforceSizeLimit (segment-based gate)', () => {
  it('measures the segments and accepts a document within the default limit', () => {
    const result = enforceSizeLimit(segmentsOf('hello world', 'a b c'), NO_OVERRIDES);
    expect(result).toEqual({
      status: 'within-limit',
      effectiveLimitWords: DEFAULT_SIZE_LIMIT_WORDS,
      measuredWords: 5,
    });
  });

  it('rejects when measured segment words exceed a small effective override', () => {
    const overrides: SizeLimitOverrides = {
      documentTypeSizeLimitWords: 3,
    };
    const result = enforceSizeLimit(segmentsOf('one two', 'three four'), overrides);
    expect(result.status).toBe('over-limit');
    expect(result.effectiveLimitWords).toBe(3);
    expect(result.measuredWords).toBe(4);
  });

  it('accepts a document exactly at a Document Type override limit (boundary)', () => {
    const overrides: SizeLimitOverrides = {
      documentTypeSizeLimitWords: 4,
    };
    const result = enforceSizeLimit(segmentWithWords(4), overrides);
    expect(result.status).toBe('within-limit');
    expect(result.measuredWords).toBe(4);
  });

  it('accepts an empty document (0 words)', () => {
    const result = enforceSizeLimit([], NO_OVERRIDES);
    expect(result).toEqual({
      status: 'within-limit',
      effectiveLimitWords: DEFAULT_SIZE_LIMIT_WORDS,
      measuredWords: 0,
    });
  });
});
