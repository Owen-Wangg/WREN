/**
 * Property-based test: citation field length is bounded
 * (footnote-citation-support spec, Task 3.6).
 *
 * Feature: footnote-citation-support, Property 5: Citation field length is bounded
 *
 * For any string assigned to a footnote's `author`, `title`, `source`,
 * `pinpoint`, or `year` field, the assignment succeeds iff the string is 500
 * characters or fewer; a string exceeding 500 characters is rejected and the
 * field's previous value is retained.
 *
 * Validates: Requirements 3.4
 */
import { Editor, getSchema } from '@tiptap/core';
import DocumentExt from '@tiptap/extension-document';
import ParagraphExt from '@tiptap/extension-paragraph';
import TextExt from '@tiptap/extension-text';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CITATION_FIELD_NAMES, FootnoteNode, MAX_CITATION_FIELD_LENGTH } from './tiptapFootnote';

const extensions = [DocumentExt, ParagraphExt, TextExt, FootnoteNode];
const schema = getSchema(extensions);
void schema;

function buildEditorWithOneFootnote(): Editor {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'footnote',
            attrs: {
              footnoteNumber: 1,
              content: { type: 'doc', content: [{ type: 'paragraph' }] },
              author: 'Original Author',
              title: 'Original Title',
              source: '',
              pinpoint: '',
              year: '',
            },
          },
        ],
      },
    ],
  };
  return new Editor({ extensions, content });
}

function footnoteAttrs(editor: Editor): Record<string, unknown> {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'footnote') attrs = node.attrs;
  });
  return (attrs ?? {}) as Record<string, unknown>;
}

const fieldNameArb = fc.constantFrom(...CITATION_FIELD_NAMES);

describe('Property 5: citation field length is bounded', () => {
  it('accepts a field value iff its length is <= 500 chars; rejects (no-op) otherwise', () => {
    fc.assert(
      fc.property(fieldNameArb, fc.integer({ min: 0, max: 600 }), (field, length) => {
        const editor = buildEditorWithOneFootnote();
        const before = footnoteAttrs(editor);
        const candidate = 'x'.repeat(length);

        const result = editor.commands.updateFootnoteFields(1, { [field]: candidate });
        const after = footnoteAttrs(editor);

        if (length <= MAX_CITATION_FIELD_LENGTH) {
          expect(result).toBe(true);
          expect(after[field]).toBe(candidate);
        } else {
          expect(result).toBe(false);
          // Previous value retained — the entire patch is rejected, not
          // silently truncated.
          expect(after[field]).toBe(before[field]);
        }

        editor.destroy();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects the whole patch (no partial apply) when one field is too long but others are valid', () => {
    fc.assert(
      fc.property(fc.integer({ min: 501, max: 700 }), (badLength) => {
        const editor = buildEditorWithOneFootnote();
        const before = footnoteAttrs(editor);

        const result = editor.commands.updateFootnoteFields(1, {
          author: 'Valid Author',
          title: 'x'.repeat(badLength),
        });
        const after = footnoteAttrs(editor);

        expect(result).toBe(false);
        // Neither field changed — the too-long title blocked the entire patch.
        expect(after.author).toBe(before.author);
        expect(after.title).toBe(before.title);

        editor.destroy();
      }),
      { numRuns: 100 },
    );
  });

  it('exactly 500 characters is accepted (boundary inclusive)', () => {
    const editor = buildEditorWithOneFootnote();
    const exactly500 = 'y'.repeat(500);
    const result = editor.commands.updateFootnoteFields(1, { source: exactly500 });
    expect(result).toBe(true);
    expect(footnoteAttrs(editor).source).toBe(exactly500);
    editor.destroy();
  });

  it('exactly 501 characters is rejected (boundary exclusive)', () => {
    const editor = buildEditorWithOneFootnote();
    const before = footnoteAttrs(editor);
    const exactly501 = 'z'.repeat(501);
    const result = editor.commands.updateFootnoteFields(1, { source: exactly501 });
    expect(result).toBe(false);
    expect(footnoteAttrs(editor).source).toBe(before.source);
    editor.destroy();
  });
});
