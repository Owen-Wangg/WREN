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

  // Persisted attrs must not break out of
  // src="…" / style="…" in the innerHTML-rendered export host.
  describe('attribute injection', () => {
    const BREAKOUT = 'x" onerror="alert(1)';

    function render(content: JSONContent['content']): HTMLElement {
      const host = document.createElement('div');
      host.innerHTML = tiptapContentToHtml({ type: 'doc', content });
      return host;
    }

    it('drops images with an unsafe src and keeps safe ones', () => {
      const host = render([
        { type: 'image', attrs: { src: BREAKOUT } },
        { type: 'image', attrs: { src: 'javascript:alert(1)' } },
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'a" onload="x' } },
      ]);
      const images = host.querySelectorAll('img');
      expect(images).toHaveLength(1);
      expect(images[0]!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      expect(images[0]!.getAttribute('alt')).toBe('a" onload="x');
      expect(host.querySelector('[onerror],[onload]')).toBeNull();
    });

    it('ignores unsafe mark attrs instead of interpolating them into style', () => {
      const host = render([
        {
          type: 'paragraph',
          attrs: { textAlign: 'center;background:url(https://x)' },
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'highlight', attrs: { color: BREAKOUT } }] },
            {
              type: 'text',
              text: 'b',
              marks: [
                {
                  type: 'textStyle',
                  attrs: { color: BREAKOUT, fontFamily: BREAKOUT, fontSize: BREAKOUT },
                },
              ],
            },
          ],
        },
      ]);
      expect(host.querySelector('[onerror]')).toBeNull();
      const html = host.innerHTML;
      expect(html).not.toContain('alert');
      expect(html).not.toContain('url(');
      expect(html).toContain('background-color:#ffff00');
    });

    it('keeps legitimate styles, including quoted font stacks', () => {
      const host = render([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'styled',
              marks: [
                {
                  type: 'textStyle',
                  attrs: {
                    color: '#b91c1c',
                    fontSize: '18pt',
                    fontFamily: '"Times New Roman", Times, serif',
                  },
                },
              ],
            },
          ],
        },
      ]);
      const span = host.querySelector('span')!;
      expect(span.style.color).toBe('rgb(185, 28, 28)');
      expect(span.style.fontSize).toBe('18pt');
      expect(span.style.fontFamily).toContain('Times New Roman');
    });
  });
});
