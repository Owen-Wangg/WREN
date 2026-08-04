/**
 * End-to-end integration test for the full footnote lifecycle
 * (footnote-citation-support spec, Task 14.1).
 *
 * Exercises the complete path:
 *   1. Create a document → insert footnotes via editor commands
 *   2. Extract TipTap JSON (simulates autosave/persist)
 *   3. Reload from persisted JSON (simulates page reload)
 *   4. Run `extractFootnotes` (the function the Node side calls to produce
 *      the payload for the Python Feedback Engine)
 *   5. Verify the extracted footnotes have the shape that
 *      `build_footnotes_untrusted_content` expects: each entry has a valid
 *      footnoteNumber, content, and citation fields
 *
 * This validates the contract between the Tiptap editor layer, the
 * `@wren/types` extraction layer, and the Python Feedback Engine's
 * `FootnoteMetadata` consumer — without needing actual database or Bedrock
 * calls.
 *
 * Validates: Requirements 2.2, 5.1, 5.2, 5.6
 */
import { Editor } from '@tiptap/core';
import DocumentExt from '@tiptap/extension-document';
import ParagraphExt from '@tiptap/extension-paragraph';
import TextExt from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';

import { FootnoteNode } from './tiptapFootnote';
import { extractFootnotes, tipTapContentToSegments, type TipTapNode } from '../../../types/src/tiptapContent';

const extensions = [DocumentExt, ParagraphExt, TextExt, FootnoteNode];

function buildEditor(content?: Record<string, unknown>): Editor {
  return new Editor({
    extensions,
    content: content ?? {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Introduction to the case.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'The court held that the duty of care was established.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Conclusion: the appeal was dismissed.' }] },
      ],
    },
  });
}

describe('Task 14.1: end-to-end footnote lifecycle integration', () => {
  it('insert footnotes → save → reload → extractFootnotes produces valid metadata for the Feedback Engine', () => {
    // ── Step 1: Create a document and insert footnotes via commands ──
    const editor = buildEditor();

    // Position cursor at end of first paragraph and insert a footnote
    const firstParaEnd = editor.state.doc.child(0).nodeSize - 1;
    editor.commands.setTextSelection(firstParaEnd);
    expect(editor.commands.insertFootnote()).toBe(true);

    // Position cursor at end of second paragraph and insert another
    // (need to recalculate since the doc changed)
    const secondParaStart = editor.state.doc.child(0).nodeSize;
    const secondParaEnd = secondParaStart + editor.state.doc.child(1).nodeSize - 1;
    editor.commands.setTextSelection(secondParaEnd);
    expect(editor.commands.insertFootnote()).toBe(true);

    // ── Step 2: Extract TipTap JSON (simulates autosave) ──
    const savedContent = editor.getJSON();
    expect(savedContent).toBeDefined();
    expect(savedContent.type).toBe('doc');

    // ── Step 3: Reload from JSON (simulates page reload) ──
    const reloadedEditor = new Editor({
      extensions,
      content: savedContent,
    });
    const reloadedContent = reloadedEditor.getJSON();

    // Content survives the round-trip (Requirement 2.2)
    expect(JSON.stringify(reloadedContent)).toBe(JSON.stringify(savedContent));

    // ── Step 4: Run extractFootnotes ──
    const extracted = extractFootnotes(reloadedContent as unknown as TipTapNode);

    // ── Step 5: Verify the extracted metadata ──
    expect(extracted).toHaveLength(2);

    // Sorted ascending by footnoteNumber
    expect(extracted[0]!.footnoteNumber).toBe(1);
    expect(extracted[1]!.footnoteNumber).toBe(2);

    // Each entry has the fields the Python FootnoteMetadata expects
    for (const fn of extracted) {
      expect(typeof fn.footnoteNumber).toBe('number');
      expect(fn.footnoteNumber).toBeGreaterThan(0);
      expect(typeof fn.content).toBe('string');
      expect(typeof fn.paragraphIndex).toBe('number');
      expect(typeof fn.author).toBe('string');
      expect(typeof fn.title).toBe('string');
      expect(typeof fn.source).toBe('string');
      expect(typeof fn.pinpoint).toBe('string');
      expect(typeof fn.year).toBe('string');
    }

    // paragraphIndex reflects the paragraph the footnote is in
    expect(extracted[0]!.paragraphIndex).toBe(0);
    expect(extracted[1]!.paragraphIndex).toBe(1);

    reloadedEditor.destroy();
    editor.destroy();
  });

  it('updateFootnoteFields persists through save/reload and appears in extractFootnotes', () => {
    const editor = buildEditor();

    // Insert a footnote
    editor.commands.setTextSelection(1);
    editor.commands.insertFootnote();

    // Update its citation fields
    editor.commands.updateFootnoteFields(1, {
      author: 'R. Smith',
      title: 'Contract Law',
      year: '2019',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See the analysis at para 42.' }] }],
      },
    });

    // Save and reload
    const saved = editor.getJSON();
    const reloaded = new Editor({ extensions, content: saved });
    const extracted = extractFootnotes(reloaded.getJSON() as unknown as TipTapNode);

    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.author).toBe('R. Smith');
    expect(extracted[0]!.title).toBe('Contract Law');
    expect(extracted[0]!.year).toBe('2019');
    expect(extracted[0]!.content).toContain('See the analysis at para 42.');

    reloaded.destroy();
    editor.destroy();
  });

  it('deleteFootnote removes the footnote from extractFootnotes output', () => {
    const editor = buildEditor();

    // Insert two footnotes
    editor.commands.setTextSelection(1);
    editor.commands.insertFootnote();
    const afterFirst = editor.state.doc.child(0).nodeSize;
    editor.commands.setTextSelection(afterFirst + 1);
    editor.commands.insertFootnote();

    // Verify two exist
    let extracted = extractFootnotes(editor.getJSON() as unknown as TipTapNode);
    expect(extracted).toHaveLength(2);

    // Delete footnote 1
    editor.commands.deleteFootnote(1);

    // After deletion and renumbering, only one remains (renumbered to 1)
    extracted = extractFootnotes(editor.getJSON() as unknown as TipTapNode);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.footnoteNumber).toBe(1);

    editor.destroy();
  });

  it('zero footnotes → extractFootnotes returns [] (Requirement 5.6)', () => {
    const editor = buildEditor();
    const extracted = extractFootnotes(editor.getJSON() as unknown as TipTapNode);
    expect(extracted).toHaveLength(0);
    editor.destroy();
  });

  it('segment text includes [N] placeholders for footnotes (Requirement 5.4)', () => {
    const editor = buildEditor();

    // Insert a footnote in the first paragraph
    const firstParaEnd = editor.state.doc.child(0).nodeSize - 1;
    editor.commands.setTextSelection(firstParaEnd);
    editor.commands.insertFootnote();

    const segments = tipTapContentToSegments(editor.getJSON() as unknown as TipTapNode);

    // The first segment should contain the [1] placeholder
    expect(segments[0]!.text).toContain('[1]');
    // Other segments should NOT contain placeholders
    expect(segments[1]!.text).not.toMatch(/\[\d+\]/);
    expect(segments[2]!.text).not.toMatch(/\[\d+\]/);

    editor.destroy();
  });
});
