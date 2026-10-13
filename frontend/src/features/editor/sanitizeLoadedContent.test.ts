import { describe, expect, it } from 'vitest';

import type { JSONContent } from '@tiptap/react';

import {
  isWrapContinuation,
  sanitizeOptionsForDraft,
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

function blockText(node: JSONContent | undefined): string {
  return node?.content?.map((n) => n.text ?? '').join('') ?? '';
}

const OCR = { isOcr: true } as const;

describe('sanitizeTipTapContent (OCR drafts)', () => {
  it('strips center alignment from long body paragraphs', () => {
    const raw = doc(
      para(
        'This memo looks at whether Kato is responsible for the accident that happened at the premises.',
        { textAlign: 'center' },
      ),
    );
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(fixed.content?.[0]?.attrs?.textAlign).toBeUndefined();
  });

  it('keeps center alignment on short lines that may be titles', () => {
    const raw = doc(para('Facts', { textAlign: 'center' }));
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(fixed.content?.[0]?.attrs?.textAlign).toBe('center');
  });

  it('stitches mid-sentence wrap fragments and keeps the first paragraph attrs', () => {
    const raw = doc(
      para("Vicarious liability will typically not extend to include the franchisee's"),
      para('wrongdoings.', { indent: 3, textAlign: 'center' }),
    );
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(fixed.content).toHaveLength(1);
    expect(blockText(fixed.content?.[0])).toContain("franchisee's wrongdoings.");
    expect(fixed.content?.[0]?.attrs).toBeUndefined();
  });

  it('stitches capital-letter continuations after hanging words', () => {
    const raw = doc(
      para('activities conducted on those premises and the'),
      para('Furthermore, "premises" includes land and structures.'),
    );
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(fixed.content).toHaveLength(1);
    expect(blockText(fixed.content?.[0])).toContain('and the Furthermore');
  });

  it('does not snowball title-page lines with different alignment', () => {
    const raw = doc(
      para('And'),
      para('James Douglas Pearman and Christine Sheila Kuramoto', { textAlign: 'center' }),
      para('Defendants', { textAlign: 'right' }),
      para('Before: The Honourable Justice K. Loo', { textAlign: 'center' }),
    );
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(fixed.content?.map(blockText)).toEqual([
      'And',
      'James Douglas Pearman and Christine Sheila Kuramoto',
      'Defendants',
      'Before: The Honourable Justice K. Loo',
    ]);
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
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(blockText(fixed.content?.[0])).toBe('The Negligence Act');
  });

  it('splits glued OCR words but keeps surname prefixes', () => {
    const raw = doc(para('TheNegligence claim against K. MacEwan and McDonald.'));
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(blockText(fixed.content?.[0])).toBe(
      'The Negligence claim against K. MacEwan and McDonald.',
    );
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
    const fixed = sanitizeTipTapContent(raw, OCR);
    const marks = fixed.content?.[0]?.content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(marks.some((m) => m.type === 'bold')).toBe(false);
  });

  it('reports when repair is needed', () => {
    const raw = doc(
      para('Long centered paragraph with many words in the body.', { textAlign: 'center' }),
    );
    const fixed = sanitizeTipTapContent(raw, OCR);
    expect(tipTapContentNeedsSanitization(raw, fixed)).toBe(true);
    expect(tipTapContentNeedsSanitization(fixed, fixed)).toBe(false);
  });
});

describe('sanitizeTipTapContent (digital / typed drafts)', () => {
  it('caps oversized fontSize marks for every draft', () => {
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

  it('leaves exact text, centered lines, and emphasis untouched', () => {
    const raw = doc(
      para('James Douglas Pearman and Christine Sheila Kuramoto', { textAlign: 'center' }),
      para('Counsel for the Defendant K. MacEwan'),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Pearman v. Kuramoto', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'Bergen v. Bergen', marks: [{ type: 'italic' }] },
        ],
      },
    );
    const fixed = sanitizeTipTapContent(raw, sanitizeOptionsForDraft({}));
    expect(fixed).toEqual(raw);
    expect(tipTapContentNeedsSanitization(raw, fixed)).toBe(false);
  });
});

describe('sanitizeTipTapContent (attribute allowlist)', () => {
  const unsafe = doc(
    {
      type: 'paragraph',
      attrs: { textAlign: 'center;background:url(x)', indent: 2 },
      content: [
        {
          type: 'text',
          text: 'Facts',
          marks: [
            {
              type: 'textStyle',
              attrs: { fontFamily: 'x;}body{display:none', fontSize: '12pt' },
            },
          ],
        },
      ],
    },
    { type: 'image', attrs: { src: 'javascript:alert(1)' } },
  );

  it.each([
    ['digital', {}],
    ['OCR', OCR],
  ])('strips unsafe attribute values on %s drafts', (_label, options) => {
    const fixed = sanitizeTipTapContent(unsafe, options);
    expect(fixed.content).toHaveLength(1);
    const block = fixed.content?.[0];
    expect(block?.attrs?.textAlign ?? null).toBeNull();
    expect(block?.attrs?.indent).toBe(2);
    const mark = block?.content?.[0]?.marks?.[0];
    expect(mark?.attrs).toEqual({ fontSize: '12pt' });
  });

  it('keeps PDF-import fonts and layout attrs on digital drafts', () => {
    const raw = doc({
      type: 'paragraph',
      attrs: { textAlign: 'center', indent: 1 },
      content: [
        {
          type: 'text',
          text: 'Supreme Court of British Columbia',
          marks: [
            { type: 'bold' },
            {
              type: 'textStyle',
              attrs: { fontFamily: '"Times New Roman", serif', fontSize: '14pt' },
            },
          ],
        },
      ],
    });
    expect(sanitizeTipTapContent(raw)).toEqual(raw);
  });
});

describe('sanitizeOptionsForDraft', () => {
  it('flags only drafts with an OCR confidence score', () => {
    expect(sanitizeOptionsForDraft({ ocrConfidence: 91.2 })).toEqual({ isOcr: true });
    expect(sanitizeOptionsForDraft({ ocrConfidence: 0 })).toEqual({ isOcr: true });
    expect(sanitizeOptionsForDraft({})).toEqual({ isOcr: false });
    expect(sanitizeOptionsForDraft(null)).toEqual({ isOcr: false });
  });
});

describe('isWrapContinuation', () => {
  it('detects lowercase and capital continuations', () => {
    expect(isWrapContinuation("the franchisee's", 'wrongdoings.')).toBe(true);
    expect(isWrapContinuation('End.', 'wrongdoings.')).toBe(false);
    expect(isWrapContinuation('and the', 'Furthermore, premises')).toBe(true);
  });
});
