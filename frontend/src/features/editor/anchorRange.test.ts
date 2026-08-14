import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { findQuotedTextRange, resolveDebriefHighlightRange } from './anchorRange';

import type { JSONContent } from '@tiptap/react';

function docFrom(content: JSONContent) {
  const editor = new Editor({
    extensions: [StarterKit],
    content,
  });
  const doc = editor.state.doc;
  editor.destroy();
  return doc;
}

describe('findQuotedTextRange', () => {
  it('finds a quote inside a nested list item, not only top-level paragraphs', () => {
    const doc = docFrom({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Introduction.' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'The court held that the appeal succeeded.' }],
                },
              ],
            },
          ],
        },
      ],
    });

    const range = findQuotedTextRange(doc, 'the appeal succeeded');
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toContain('appeal succeeded');
  });

  it('matches quotes when the paragraph has extra newlines', () => {
    const doc = docFrom({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'One employee described\nthe incident in detail.' }],
        },
      ],
    });

    const range = findQuotedTextRange(doc, 'One employee described the incident in detail.');
    expect(range).not.toBeNull();
  });
});

describe('resolveDebriefHighlightRange', () => {
  it('highlights from quoted text even when the stored paragraph index is wrong', () => {
    const doc = docFrom({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Alpha.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'The duty of care was breached.' }] },
      ],
    });

    const range = resolveDebriefHighlightRange(doc, {
      anchor: { paragraphIndex: 0, startOffset: 0, endOffset: 5 },
      quotedText: 'The duty of care was breached.',
    });
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toContain('duty of care');
  });
});
