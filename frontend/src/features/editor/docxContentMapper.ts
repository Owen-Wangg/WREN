/**
 * `.docx` ⇄ Tiptap content mapping (task 18.1; Requirements 6.2, 52.1, 52.2).
 *
 * WREN's document editor is built on a Tiptap (`@tiptap/react` + `@tiptap/starter-kit`,
 * MIT) editing surface, backed by two MIT-licensed conversion libraries:
 *   - `officeparser` (MIT, harshankur/officeParser) parses an uploaded `.docx` into a
 *     structured AST, which this module maps into Tiptap's `JSONContent` document model.
 *   - `docx` (MIT, dolanmiu/docx) generates a `.docx` file from a declarative
 *     Document/Paragraph/TextRun object model, which this module builds from the
 *     editor's `JSONContent` output.
 *
 * `mammoth.js` (BSD-2-Clause) and Syncfusion Document Editor (commercial) were
 * evaluated and rejected — the OSS deliverable (Requirement 52.1) requires an
 * MIT-only stack end to end.
 *
 * Only the subset of formatting StarterKit ships by default is mapped: paragraphs,
 * headings (levels 1-6), and the bold/italic/underline/strike marks. Requirement 6.2
 * requires paragraph *structure* (boundaries + ordering) to be preserved across the
 * import → edit → export round-trip; this module is the single place that invariant is
 * implemented, so both directions of the mapping stay in sync.
 */
import type { JSONContent } from '@tiptap/react';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { OfficeParser, type OfficeContentNode } from 'officeparser';

/** The subset of Tiptap node types this mapper understands. */
type SupportedNodeType = 'doc' | 'paragraph' | 'heading' | 'text';

const HEADING_LEVEL_BY_NUMBER: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/**
 * Recursively walks an `officeparser` AST node, extracting `heading`/`paragraph`
 * nodes as ordered Tiptap block nodes. Non-text structural nodes (tables, images,
 * lists, etc.) are intentionally out of scope for this task — task 18.1 is limited
 * to plain paragraphs/headings/text formatting, matching what StarterKit renders.
 */
function officeNodeToTiptapBlocks(node: OfficeContentNode): JSONContent[] {
  if (node.type === 'heading' || node.type === 'paragraph') {
    const textNodes = collectTextRuns(node);
    const block: JSONContent = {
      type: node.type === 'heading' ? 'heading' : 'paragraph',
      ...(node.type === 'heading'
        ? { attrs: { level: node.metadata?.level ?? 1 } }
        : {}),
      content: textNodes.length > 0 ? textNodes : undefined,
    };
    return [block];
  }

  // Container nodes (e.g. the document root) are flattened by recursing into
  // their children and concatenating the resulting blocks in order, which is
  // what preserves paragraph ordering end to end.
  if (node.children && node.children.length > 0) {
    return node.children.flatMap(officeNodeToTiptapBlocks);
  }

  return [];
}

/** Collects leaf `text` nodes under a paragraph/heading into Tiptap text nodes with marks. */
function collectTextRuns(node: OfficeContentNode): JSONContent[] {
  const runs: JSONContent[] = [];

  const visit = (current: OfficeContentNode) => {
    if (current.type === 'text' && current.text) {
      runs.push({
        type: 'text',
        text: current.text,
        marks: formattingToMarks(current.formatting),
      });
      return;
    }
    current.children?.forEach(visit);
  };

  if (node.children && node.children.length > 0) {
    node.children.forEach(visit);
  } else if (node.text) {
    // Fallback: some formats collapse text directly onto the paragraph node.
    runs.push({ type: 'text', text: node.text, marks: formattingToMarks(node.formatting) });
  }

  return runs.filter((run) => run.text !== undefined && run.text !== '');
}

function formattingToMarks(
  formatting: OfficeContentNode['formatting'],
): JSONContent['marks'] {
  if (!formatting) return undefined;

  const marks: NonNullable<JSONContent['marks']> = [];
  if (formatting.bold) marks.push({ type: 'bold' });
  if (formatting.italic) marks.push({ type: 'italic' });
  if (formatting.underline) marks.push({ type: 'underline' });
  if (formatting.strikethrough) marks.push({ type: 'strike' });

  return marks.length > 0 ? marks : undefined;
}

/**
 * Parses a `.docx` file (as bytes) via `officeparser` and returns Tiptap
 * `JSONContent` suitable for `useEditor({ content })`, preserving paragraph
 * boundaries and ordering (Requirement 6.2).
 */
export async function docxBytesToTiptapContent(
  bytes: Uint8Array,
): Promise<JSONContent> {
  const ast = await OfficeParser.parseOffice(bytes, { fileType: 'docx' });

  const blocks = ast.content.flatMap(officeNodeToTiptapBlocks);

  return {
    type: 'doc',
    // A document must contain at least one paragraph for Tiptap's schema.
    content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
  };
}

/**
 * Builds a `.docx` `Blob` from the editor's current `JSONContent`, mapping
 * paragraphs/headings and the bold/italic/underline/strike marks onto `docx`'s
 * Paragraph/TextRun/Document model. Only the node/mark types produced by
 * `@tiptap/starter-kit`'s default configuration are handled (Requirement 6.2,
 * 52.1, 52.2 — this task's scope excludes tables, images, and lists).
 */
export async function tiptapContentToDocxBlob(
  content: JSONContent,
): Promise<Blob> {
  const paragraphs = tiptapContentToDocxParagraphs(content);
  const document = new Document({
    sections: [{ children: paragraphs.length > 0 ? paragraphs : [new Paragraph({})] }],
  });

  return Packer.toBlob(document);
}

/** Exposed for the round-trip test — maps Tiptap `JSONContent` to `docx` Paragraphs. */
export function tiptapContentToDocxParagraphs(content: JSONContent): Paragraph[] {
  const blocks = content.content ?? [];

  return blocks
    .filter((node): node is JSONContent & { type: SupportedNodeType } =>
      node.type === 'paragraph' || node.type === 'heading',
    )
    .map((node) => {
      const children = tiptapInlineContentToRuns(node.content ?? []);
      if (node.type === 'heading') {
        const level = Number(node.attrs?.level ?? 1);
        return new Paragraph({
          heading: HEADING_LEVEL_BY_NUMBER[level] ?? HeadingLevel.HEADING_1,
          children,
        });
      }
      return new Paragraph({ children });
    });
}

function tiptapInlineContentToRuns(inline: JSONContent[]): ParagraphChild[] {
  return inline
    .filter((node) => node.type === 'text' && typeof node.text === 'string')
    .map((node) => {
      const markTypes = new Set((node.marks ?? []).map((mark) => mark.type));
      return new TextRun({
        text: node.text ?? '',
        bold: markTypes.has('bold'),
        italics: markTypes.has('italic'),
        underline: markTypes.has('underline') ? {} : undefined,
        strike: markTypes.has('strike'),
      });
    });
}

/** Counts ordered paragraph/heading blocks in a Tiptap document — the unit the
 * import/edit/export round-trip must preserve (Requirement 6.2). */
export function countParagraphBlocks(content: JSONContent): number {
  return (content.content ?? []).filter(
    (node) => node.type === 'paragraph' || node.type === 'heading',
  ).length;
}

/**
 * Maps ordered draft segments (`{ index, text }`) into a TipTap document.
 * Used when loading a persisted draft into the editor.
 */
export function segmentsToTiptapContent(
  segments: ReadonlyArray<{ index: number; text: string }>,
): JSONContent {
  const sorted = [...segments].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc',
    content: sorted.map((segment) => ({
      type: 'paragraph' as const,
      content: segment.text.length > 0 ? [{ type: 'text' as const, text: segment.text }] : undefined,
    })),
  };
}
