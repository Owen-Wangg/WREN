import { describe, expect, it } from 'vitest';

import {
  estimatePrintedPageCount,
  printedPageCountFromHostHeight,
  tiptapContentToHtml,
} from './pdfExport';

import type { JSONContent } from '@tiptap/react';

describe('printedPageCountFromHostHeight', () => {
  it('returns 1 for empty or invalid heights', () => {
    expect(printedPageCountFromHostHeight(0)).toBe(1);
    expect(printedPageCountFromHostHeight(-10)).toBe(1);
    expect(printedPageCountFromHostHeight(Number.NaN)).toBe(1);
  });

  it('maps 1088px of the 816px export host to exactly one letter page', () => {
    expect(printedPageCountFromHostHeight(1088)).toBe(1);
    expect(printedPageCountFromHostHeight(1089)).toBe(2);
  });
});

describe('estimatePrintedPageCount', () => {
  it('returns at least 1 for a short document in jsdom', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };
    await expect(estimatePrintedPageCount(content)).resolves.toBeGreaterThanOrEqual(1);
  });
});

describe('tiptapContentToHtml', () => {
  it('preserves headings, bold/italic, and lists', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Holdings' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
              ],
            },
          ],
        },
      ],
    };

    const html = tiptapContentToHtml(content);
    expect(html).toContain('<h2');
    expect(html).toContain('Holdings');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<ol>');
    expect(html).toContain('First');
  });
});
