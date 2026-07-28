/**
 * `.docx` ⇄ Tiptap content mapping (Requirements 6.2, 52.1, 52.2).
 *
 * Scope B+: paragraphs, headings, bold/italic/underline/strike, font size,
 * paragraph indent, lists (nested), tables.
 * Images / headers / footers remain out of scope.
 *
 * Libraries (MIT):
 *   - `officeparser` — parse uploaded `.docx` into a structured AST
 *   - `docx` — generate `.docx` from TipTap JSON
 */
import type { JSONContent } from '@tiptap/react';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
  type Table as DocxTable,
} from 'docx';
import { OfficeParser, type OfficeContentNode } from 'officeparser';

import { MAX_INDENT_LEVEL } from './tiptapIndent';

const HEADING_LEVEL_BY_NUMBER: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/** ~720 twips ≈ 0.5" — one Word indent step. */
const TWIPS_PER_INDENT_LEVEL = 720;

/** Normalize officeparser size strings ("14pt", "0.5in") to a TipTap fontSize value. */
export function normalizeFontSize(size: string | undefined): string | undefined {
  if (!size || typeof size !== 'string') return undefined;
  const trimmed = size.trim();
  if (!trimmed) return undefined;
  const pt = /^([\d.]+)\s*pt$/i.exec(trimmed);
  if (pt) {
    const n = Number.parseFloat(pt[1]!);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return `${Math.round(n)}pt`;
  }
  const inch = /^([\d.]+)\s*in$/i.exec(trimmed);
  if (inch) {
    const n = Number.parseFloat(inch[1]!);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return `${Math.round(n * 72)}pt`;
  }
  const bare = /^([\d.]+)$/.exec(trimmed);
  if (bare) {
    const n = Number.parseFloat(bare[1]!);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return `${Math.round(n)}pt`;
  }
  return trimmed;
}

/** Convert OOXML twips (or first-line) into indent levels 0–8. Prefer left, else firstLine. */
export function twipsToIndentLevel(
  indentation:
    | { left?: number; firstLine?: number; hanging?: number }
    | undefined
    | null,
): number {
  if (!indentation) return 0;
  const raw =
    typeof indentation.left === 'number' && indentation.left > 0
      ? indentation.left
      : typeof indentation.firstLine === 'number' && indentation.firstLine > 0
        ? indentation.firstLine
        : 0;
  if (raw <= 0) return 0;
  return Math.min(MAX_INDENT_LEVEL, Math.max(0, Math.round(raw / TWIPS_PER_INDENT_LEVEL)));
}

function indentAttrsFromOffice(node: OfficeContentNode): { indent?: number } {
  const meta = node.metadata as
    | { paragraphIndentation?: { left?: number; firstLine?: number; hanging?: number } }
    | undefined;
  const level = twipsToIndentLevel(meta?.paragraphIndentation);
  return level > 0 ? { indent: level } : {};
}

/** officeparser list nesting — prefer `indentation`, fall back to legacy `level`. */
function listNestingLevel(node: OfficeContentNode): number {
  const meta = node.metadata as
    | { indentation?: number; level?: number }
    | undefined;
  if (!meta) return 0;
  if (typeof meta.indentation === 'number') return meta.indentation;
  if (typeof meta.level === 'number') return meta.level;
  return 0;
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

  const fontSize = normalizeFontSize(
    typeof formatting.size === 'string' ? formatting.size : undefined,
  );
  if (fontSize) {
    marks.push({ type: 'textStyle', attrs: { fontSize } });
  }

  return marks.length > 0 ? marks : undefined;
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
    runs.push({ type: 'text', text: node.text, marks: formattingToMarks(node.formatting) });
  }

  return runs.filter((run) => run.text !== undefined && run.text !== '');
}

function paragraphOrHeadingFromOffice(node: OfficeContentNode): JSONContent {
  const textNodes = collectTextRuns(node);
  const indent = indentAttrsFromOffice(node);
  if (node.type === 'heading') {
    return {
      type: 'heading',
      attrs: { level: node.metadata?.level ?? 1, ...indent },
      content: textNodes.length > 0 ? textNodes : undefined,
    };
  }
  return {
    type: 'paragraph',
    ...(Object.keys(indent).length > 0 ? { attrs: indent } : {}),
    content: textNodes.length > 0 ? textNodes : undefined,
  };
}

function listItemFromOffice(node: OfficeContentNode): JSONContent {
  return {
    type: 'listItem',
    content: [
      {
        type: 'paragraph',
        content: (() => {
          const runs = collectTextRuns(node);
          return runs.length > 0 ? runs : undefined;
        })(),
      },
    ],
  };
}

/**
 * Group consecutive office `list` items into TipTap bulletList / orderedList.
 * Nested levels become nested lists under the previous item when level increases.
 */
function consumeListGroup(
  nodes: OfficeContentNode[],
  startIndex: number,
): { blocks: JSONContent[]; nextIndex: number } {
  const first = nodes[startIndex]!;
  const listType =
    first.metadata && 'listType' in first.metadata && first.metadata.listType === 'ordered'
      ? 'orderedList'
      : 'bulletList';
  const baseLevel = listNestingLevel(first);

  const items: JSONContent[] = [];
  let i = startIndex;
  while (i < nodes.length && nodes[i]?.type === 'list') {
    const node = nodes[i]!;
    const level = listNestingLevel(node);
    const nodeListType =
      node.metadata && 'listType' in node.metadata && node.metadata.listType === 'ordered'
        ? 'orderedList'
        : 'bulletList';
    if (nodeListType !== listType && level <= baseLevel) break;
    if (level < baseLevel) break;

    if (level > baseLevel) {
      const nested = consumeListGroup(nodes, i);
      const prev = items[items.length - 1];
      if (prev) {
        prev.content = [...(prev.content ?? []), ...nested.blocks];
      } else {
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph' }, ...nested.blocks],
        });
      }
      i = nested.nextIndex;
      continue;
    }

    items.push(listItemFromOffice(node));
    i += 1;
  }

  return {
    blocks: [{ type: listType, content: items }],
    nextIndex: i,
  };
}

function tableFromOffice(node: OfficeContentNode): JSONContent {
  const rows = (node.children ?? []).filter((child) => child.type === 'row');
  const tipTapRows: JSONContent[] = rows.map((row, rowIndex) => {
    const cells = (row.children ?? []).filter((child) => child.type === 'cell');
    return {
      type: 'tableRow',
      content: cells.map((cell) => {
        const cellBlocks = (cell.children ?? []).flatMap((child) =>
          officeNodesToTiptapBlocks([child]),
        );
        const cellContent =
          cellBlocks.length > 0
            ? cellBlocks
            : [
                {
                  type: 'paragraph' as const,
                  content: (() => {
                    const runs = collectTextRuns(cell);
                    return runs.length > 0 ? runs : undefined;
                  })(),
                },
              ];
        return {
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          content: cellContent.filter(
            (b) =>
              b.type === 'paragraph' ||
              b.type === 'heading' ||
              b.type === 'bulletList' ||
              b.type === 'orderedList',
          ),
        };
      }),
    };
  });

  return {
    type: 'table',
    content:
      tipTapRows.length > 0
        ? tipTapRows
        : [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
              ],
            },
          ],
  };
}

/** Convert a flat sequence of office nodes into TipTap top-level blocks. */
function officeNodesToTiptapBlocks(nodes: OfficeContentNode[]): JSONContent[] {
  const blocks: JSONContent[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!;
    if (node.type === 'heading' || node.type === 'paragraph') {
      blocks.push(paragraphOrHeadingFromOffice(node));
      i += 1;
      continue;
    }
    if (node.type === 'list') {
      const group = consumeListGroup(nodes, i);
      blocks.push(...group.blocks);
      i = group.nextIndex;
      continue;
    }
    if (node.type === 'table') {
      blocks.push(tableFromOffice(node));
      i += 1;
      continue;
    }
    if (node.children && node.children.length > 0) {
      blocks.push(...officeNodesToTiptapBlocks(node.children));
      i += 1;
      continue;
    }
    i += 1;
  }
  return blocks;
}

/**
 * Recursively walks an `officeparser` AST node (legacy entry for single roots).
 */
function officeNodeToTiptapBlocks(node: OfficeContentNode): JSONContent[] {
  return officeNodesToTiptapBlocks([node]);
}

/**
 * Parses a `.docx` file (as bytes) via `officeparser` and returns Tiptap
 * `JSONContent` suitable for `useEditor({ content })`.
 */
export async function docxBytesToTiptapContent(
  bytes: Uint8Array,
): Promise<JSONContent> {
  const ast = await OfficeParser.parseOffice(bytes, { fileType: 'docx' });
  const blocks = officeNodesToTiptapBlocks(ast.content);

  return {
    type: 'doc',
    content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
  };
}

/** TipTap `18pt` → docx half-points (36). */
function fontSizeToDocxHalfPoints(fontSize: string | undefined): number | undefined {
  if (!fontSize) return undefined;
  const normalized = normalizeFontSize(fontSize);
  if (!normalized) return undefined;
  const m = /^(\d+)pt$/i.exec(normalized);
  if (!m) return undefined;
  return Number.parseInt(m[1]!, 10) * 2;
}

function markFontSize(marks: JSONContent['marks']): string | undefined {
  const textStyle = marks?.find((m) => m.type === 'textStyle');
  const raw = textStyle?.attrs?.fontSize;
  return typeof raw === 'string' ? raw : undefined;
}

function tiptapInlineContentToRuns(inline: JSONContent[]): ParagraphChild[] {
  return inline
    .filter((node) => node.type === 'text' && typeof node.text === 'string')
    .map((node) => {
      const markTypes = new Set((node.marks ?? []).map((mark) => mark.type));
      const halfPoints = fontSizeToDocxHalfPoints(markFontSize(node.marks));
      return new TextRun({
        text: node.text ?? '',
        bold: markTypes.has('bold'),
        italics: markTypes.has('italic'),
        underline: markTypes.has('underline') ? {} : undefined,
        strike: markTypes.has('strike'),
        ...(halfPoints ? { size: halfPoints } : {}),
      });
    });
}

function paragraphIndentFromAttrs(
  attrs: Record<string, unknown> | undefined | null,
): { left: number } | undefined {
  const indent = typeof attrs?.indent === 'number' ? attrs.indent : 0;
  if (indent <= 0) return undefined;
  return { left: Math.min(MAX_INDENT_LEVEL, indent) * TWIPS_PER_INDENT_LEVEL };
}

function blockToDocxParagraph(node: JSONContent): Paragraph {
  const children = tiptapInlineContentToRuns(node.content ?? []);
  const indent = paragraphIndentFromAttrs(node.attrs as Record<string, unknown> | undefined);
  if (node.type === 'heading') {
    const level = Number(node.attrs?.level ?? 1);
    return new Paragraph({
      heading: HEADING_LEVEL_BY_NUMBER[level] ?? HeadingLevel.HEADING_1,
      children,
      ...(indent ? { indent } : {}),
    });
  }
  return new Paragraph({
    children,
    ...(indent ? { indent } : {}),
  });
}

function listToDocxParagraphs(node: JSONContent, level = 0): Paragraph[] {
  const ordered = node.type === 'orderedList';
  const out: Paragraph[] = [];
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph' || child.type === 'heading') {
        out.push(
          new Paragraph({
            children: tiptapInlineContentToRuns(child.content ?? []),
            numbering: ordered
              ? { reference: 'wren-ordered', level }
              : undefined,
            bullet: ordered ? undefined : { level },
          }),
        );
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listToDocxParagraphs(child, level + 1));
      }
    }
  }
  return out;
}

function cellBlocksToParagraphs(cell: JSONContent): Paragraph[] {
  const blocks = cell.content ?? [];
  if (blocks.length === 0) return [new Paragraph({})];
  const paragraphs: Paragraph[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') {
      paragraphs.push(blockToDocxParagraph(block));
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      paragraphs.push(...listToDocxParagraphs(block));
    }
  }
  return paragraphs.length > 0 ? paragraphs : [new Paragraph({})];
}

function tableToDocx(node: JSONContent): DocxTable {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: (row.content ?? [])
            .filter((c) => c.type === 'tableCell' || c.type === 'tableHeader')
            .map(
              (cell) =>
                new TableCell({
                  children: cellBlocksToParagraphs(cell),
                }),
            ),
        }),
    ),
  });
}

/**
 * Builds a `.docx` `Blob` from the editor's current `JSONContent`.
 */
export async function tiptapContentToDocxBlob(
  content: JSONContent,
): Promise<Blob> {
  const children = tiptapContentToDocxChildren(content);
  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'wren-ordered',
          levels: Array.from({ length: 6 }, (_, level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: 'left' as const,
          })),
        },
      ],
    },
    sections: [{ children: children.length > 0 ? children : [new Paragraph({})] }],
  });

  return Packer.toBlob(document);
}

/** Exposed for tests — maps TipTap `JSONContent` to docx section children. */
export function tiptapContentToDocxParagraphs(content: JSONContent): Paragraph[] {
  return tiptapContentToDocxChildren(content).filter(
    (child): child is Paragraph => child instanceof Paragraph,
  );
}

export function tiptapContentToDocxChildren(
  content: JSONContent,
): Array<Paragraph | DocxTable> {
  const blocks = content.content ?? [];
  const out: Array<Paragraph | DocxTable> = [];
  for (const node of blocks) {
    if (node.type === 'paragraph' || node.type === 'heading') {
      out.push(blockToDocxParagraph(node));
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      out.push(...listToDocxParagraphs(node));
    } else if (node.type === 'table') {
      out.push(tableToDocx(node));
    }
  }
  return out;
}

/** Counts top-level paragraph/heading blocks (legacy helper for tests). */
export function countParagraphBlocks(content: JSONContent): number {
  return (content.content ?? []).filter(
    (node) => node.type === 'paragraph' || node.type === 'heading',
  ).length;
}

/**
 * Maps ordered draft segments (`{ index, text }`) into a TipTap document.
 * Used when loading a persisted draft into the editor (legacy / no content).
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

// Keep export for any callers that imported the recursive walker name.
export { officeNodeToTiptapBlocks };
