import { describe, expect, it } from 'vitest';

import type { JSONContent } from '@tiptap/react';

import {
  isWrapContinuation,
  sanitizeTipTapContent,
  tipTapContentNeedsSanitization,
} from './sanitizeLoadedContent';

function para(text: string, attrs?: Record<string, unknown>): JSONContent {
  return {
    type: 'paragraph',
    ...(attrs ? { attrs } : {}),
    content: text ? [{ type: 'text', text }] : undefined,
  };
}

function doc(...blocks: JSONContent[]): JSONContent {
  return { type: 'doc', content: blocks };
}

describe('sanitizeTipTapContent', () => {
  it('strips center alignment from long body paragraphs', () => {
    const raw = doc(
      para(
        'This memo looks at whether Kato is responsible for the accident that happened at the premises.',
        { textAlign: 'center' },
      ),
    );
    const fixed = sanitizeTipTapContent(raw);
    expect(fixed.content?.[0]?.attrs?.textAlign).toBeUndefined();
  });

  it('keeps center alignment on short lines that may be titles', () => {
    const raw = doc(para('Facts', { textAlign: 'center' }));
    const fixed = sanitizeTipTapContent(raw);
    expect(fixed.content?.[0]?.attrs?.textAlign).toBe('center');
  });

  it('caps oversized fontSize marks', () => {
    const raw = doc({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: '2024',
          marks: [{ type: 'textStyle', attrs: { fontSize: '192pt' } }],
        },
      ],
    });
    const fixed = sanitizeTipTapContent(raw);
    const mark = fixed.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark?.attrs?.fontSize).toBe('36pt');
  });

  it('stitches mid-sentence wrap fragments', () => {
    const raw = doc(
      para("Vicarious liability will typically not extend to include the franchisee's"),
      para('wrongdoings.', { indent: 3, textAlign: 'center' }),
    );
    const fixed = sanitizeTipTapContent(raw);
    expect(fixed.content).toHaveLength(1);
    expect(
      fixed.content?.[0]?.content?.map((n) => n.text ?? '').join(''),
    ).toContain("franchisee's wrongdoings.");
  });

  it('stitches capital-letter continuations after hanging words', () => {
    const raw = doc(
      para('activities conducted on those premises and the'),
      para('Furthermore, "premises" includes land and structures.'),
    );
    const fixed = sanitizeTipTapContent(raw);
    expect(fixed.content).toHaveLength(1);
    expect(
      fixed.content?.[0]?.content?.map((n) => n.text ?? '').join(''),
    ).toContain('and the Furthermore');
  });

  it('inserts missing spaces between glued OCR text nodes', () => {
    const raw = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The' },
        { type: 'text', text: 'Negligence' },
        { type: 'text', text: 'Act' },
      ],
    });
    const fixed = sanitizeTipTapContent(raw);
    const text = fixed.content?.[0]?.content?.map((n) => n.text ?? '').join('') ?? '';
    expect(text).toBe('The Negligence Act');
  });

  it('strips scattered bold marks from OCR noise', () => {
    const raw = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'franchisee' },
        { type: 'text', text: ' shall ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'be liable.' },
      ],
    });
    const fixed = sanitizeTipTapContent(raw);
    const marks = fixed.content?.[0]?.content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(marks.some((m) => m.type === 'bold')).toBe(false);
  });

  it('reports when repair is needed', () => {
    const raw = doc(para('Long centered paragraph with many words in the body.', { textAlign: 'center' }));
    const fixed = sanitizeTipTapContent(raw);
    expect(tipTapContentNeedsSanitization(raw, fixed)).toBe(true);
    expect(tipTapContentNeedsSanitization(fixed, fixed)).toBe(false);
  });
});

describe('isWrapContinuation', () => {
  it('detects lowercase and capital continuations', () => {
    expect(isWrapContinuation("the franchisee's", 'wrongdoings.')).toBe(true);
    expect(isWrapContinuation('End.', 'wrongdoings.')).toBe(false);
    expect(isWrapContinuation('and the', 'Furthermore, premises')).toBe(true);
  });
});
