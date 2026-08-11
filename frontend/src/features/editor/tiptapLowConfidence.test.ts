import { Editor } from '@tiptap/core';
import DocumentExt from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import TextExt from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';

import { LowConfidence } from './tiptapLowConfidence';

describe('LowConfidence mark', () => {
  it('round-trips through the editor schema instead of being stripped', () => {
    const editor = new Editor({
      extensions: [DocumentExt, Paragraph, TextExt, LowConfidence],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'blurry word',
                marks: [{ type: 'lowConfidence' }],
              },
            ],
          },
        ],
      },
    });

    const json = editor.getJSON();
    const text = json.content?.[0]?.content?.[0];
    expect(text?.marks?.some((mark) => mark.type === 'lowConfidence')).toBe(true);
    expect(editor.getHTML()).toContain('data-ocr-low-confidence');
    editor.destroy();
  });
});
