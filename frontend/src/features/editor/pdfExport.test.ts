import { describe, expect, it } from 'vitest';

import { tiptapContentToHtml } from './pdfExport';

import type { JSONContent } from '@tiptap/react';

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
