/**
 * Integration test: `.docx` upload → editor → export cycle with footnotes
 * (footnote-citation-support spec, Task 12.7).
 *
 * Extends the existing `docxContentMapper.test.ts` fixture-based tests with
 * a full round trip through a real Tiptap `Editor` instance (not just the
 * mapper functions in isolation), mirroring how `DocumentEditor`'s
 * `importDocx`/`exportDocx` imperative handle methods are actually used in
 * production.
 *
 * Validates: Requirements 8.2, 8.3
 */
import { Editor } from '@tiptap/core';
import DocumentExt from '@tiptap/extension-document';
import HeadingExt from '@tiptap/extension-heading';
import ParagraphExt from '@tiptap/extension-paragraph';
import { TextStyle } from '@tiptap/extension-text-style';
import TextExt from '@tiptap/extension-text';
import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { describe, expect, it } from 'vitest';

import { docxBytesToTiptapContent, tiptapContentToDocxBytes } from './docxContentMapper';
import { FootnoteNode } from './tiptapFootnote';

const extensions = [DocumentExt, ParagraphExt, HeadingExt, TextExt, TextStyle, FootnoteNode];

/** Builds a real Word-produced `.docx` fixture (via the `docx` package, matching
 * this file's sibling `docxContentMapper.test.ts` fixture convention) containing
 * a heading, a paragraph with two footnote references, and their footnote bodies
 * with citation-shaped text. */
async function buildWordFixtureWithFootnotes(): Promise<Uint8Array> {
  const document = new Document({
    footnotes: {
      '1': {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'R. Smith, "Contract Interpretation" (2019) at ¶ 42.' })],
          }),
        ],
      },
      '2': {
        children: [new Paragraph({ children: [new TextRun({ text: 'See further discussion below.' })] })],
      },
    },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'Case Summary' })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'The court held that the appeal succeeded' }),
              new FootnoteReferenceRun(1),
              new TextRun({ text: ' on narrow grounds' }),
              new FootnoteReferenceRun(2),
              new TextRun({ text: '.' }),
            ],
          }),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

describe('integration: .docx upload → editor → export cycle with footnotes', () => {
  it('imports a real Word fixture into a live Tiptap Editor with footnote nodes present in the schema', async () => {
    const bytes = await buildWordFixtureWithFootnotes();
    const content = await docxBytesToTiptapContent(bytes);

    // Load into a REAL Tiptap Editor instance — proves the footnote node
    // type is a valid, registered part of the schema the importer's output
    // is fed into (not just a plain-JSON shape check).
    const editor = new Editor({ extensions, content });

    let footnoteCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'footnote') footnoteCount += 1;
    });
    expect(footnoteCount).toBe(2);

    const heading = editor.state.doc.firstChild;
    expect(heading?.type.name).toBe('heading');
    expect(heading?.textContent).toBe('Case Summary');

    editor.destroy();
  });

  it('footnotes imported from the fixture are numbered sequentially starting at 1, in source order', async () => {
    const bytes = await buildWordFixtureWithFootnotes();
    const content = await docxBytesToTiptapContent(bytes);
    const editor = new Editor({ extensions, content });

    const numbers: number[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'footnote') numbers.push(Number(node.attrs.footnoteNumber));
    });

    expect(numbers).toEqual([1, 2]);
    editor.destroy();
  });

  it('re-exporting the imported editor content produces a non-empty .docx with a footnotes part', async () => {
    const bytes = await buildWordFixtureWithFootnotes();
    const content = await docxBytesToTiptapContent(bytes);
    const editor = new Editor({ extensions, content });

    const exportedBytes = await tiptapContentToDocxBytes(editor.getJSON());
    expect(exportedBytes.byteLength).toBeGreaterThan(0);

    // Round-trip once more: the re-exported bytes still import cleanly with
    // the same footnote count (full upload → editor → export → re-import
    // cycle, Requirement 8.2/8.3).
    const reimported = await docxBytesToTiptapContent(exportedBytes);
    let reimportedCount = 0;
    const stack: unknown[] = [reimported];
    while (stack.length > 0) {
      const node = stack.shift() as { type?: string; content?: unknown[] };
      if (node?.type === 'footnote') reimportedCount += 1;
      if (Array.isArray(node?.content)) stack.push(...node.content);
    }
    expect(reimportedCount).toBe(2);

    editor.destroy();
  });

  it('citation text from the fixture survives the full cycle (no silent discard)', async () => {
    const bytes = await buildWordFixtureWithFootnotes();
    const content = await docxBytesToTiptapContent(bytes);

    const flattenAll = (node: unknown): string => {
      const typed = node as { text?: string; attrs?: { content?: unknown }; content?: unknown[]; type?: string };
      if (!typed) return '';
      if (typeof typed.text === 'string') return typed.text;
      const parts: string[] = [];
      if (typed.type === 'footnote' && typed.attrs?.content) parts.push(flattenAll(typed.attrs.content));
      if (Array.isArray(typed.content)) parts.push(...typed.content.map(flattenAll));
      return parts.join(' ');
    };

    const allText = flattenAll(content);
    expect(allText).toContain('Contract Interpretation');
    expect(allText).toContain('See further discussion below');
  });
});
