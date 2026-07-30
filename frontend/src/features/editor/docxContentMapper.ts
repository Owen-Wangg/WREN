/**
 * `.docx` ⇄ Tiptap content mapping (Requirements 6.2, 52.1, 52.2).
 *
 * Scope: paragraphs, headings, bold/italic/underline/strike, font size/family,
 * color, highlight (background), text alignment, indent, lists (nested),
 * tables, and embedded images (base64, best-effort).
 * Headers / footers remain out of scope.
 *
 * Libraries (MIT):
 *   - `officeparser` — parse uploaded `.docx` into a structured AST
 *   - `docx` — generate `.docx` from TipTap JSON
 */
import type { JSONContent } from '@tiptap/react';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
  type Table as DocxTable,
} from 'docx';
import {
  OfficeParser,
  type OfficeAttachment,
  type OfficeContentNode,
} from 'officeparser';

import { MAX_INDENT_LEVEL } from './tiptapIndent';

const HEADING_LEVEL_BY_NUMBER: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const ALIGNMENT_TO_DOCX: Record<
  string,
  (typeof AlignmentType)[keyof typeof AlignmentType]
> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

/** Map common Word typefaces onto the editor’s CSS font stacks. */
const FONT_FAMILY_BY_WORD_NAME: Record<string, string> = {
  arial: 'Arial, Helvetica, sans-serif',
  calibri: 'Calibri, Candara, Segoe UI, sans-serif',
  inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
  georgia: 'Georgia, ui-serif, serif',
  'times new roman': '"Times New Roman", Times, serif',
  times: '"Times New Roman", Times, serif',
  'courier new': '"Courier New", ui-monospace, monospace',
  courier: '"Courier New", ui-monospace, monospace',
  'source serif 4': '"Source Serif 4", ui-serif, Georgia, serif',
  'source serif': '"Source Serif 4", ui-serif, Georgia, serif',
};

/** ~720 twips ≈ 0.5" — one Word indent step. */
const TWIPS_PER_INDENT_LEVEL = 720;

/** Soft cap so draft JSON stays manageable (matches ImageInsertMenu). */
const MAX_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024);

const DEFAULT_IMAGE_WIDTH_PX = 480;
const DEFAULT_IMAGE_HEIGHT_PX = 320;

export class DocxClientParseError extends Error {
  constructor(message = 'Could not parse this Word document for rich editing.') {
    super(message);
    this.name = 'DocxClientParseError';
  }
}

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

/** Normalize `#RGB` / `#RRGGBB` / `RGB` to lowercase `#rrggbb`. */
export function normalizeHexColor(color: string | undefined | null): string | undefined {
  if (!color || typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  if (!trimmed || /^auto$/i.test(trimmed)) return undefined;
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  return undefined;
}

/** docx `color` / shading fill — six hex digits, no `#`. */
export function hexForDocx(color: string | undefined | null): string | undefined {
  const normalized = normalizeHexColor(color);
  return normalized ? normalized.slice(1) : undefined;
}

/** First typeface token from a CSS font-family stack (for Word export). */
export function primaryFontFamily(fontFamily: string | undefined | null): string | undefined {
  if (!fontFamily || typeof fontFamily !== 'string') return undefined;
  const first = fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first || undefined;
}

/** Map a Word font name to a TipTap `textStyle.fontFamily` value. */
export function mapWordFontToTipTap(font: string | undefined | null): string | undefined {
  if (!font || typeof font !== 'string') return undefined;
  const trimmed = font.trim();
  if (!trimmed) return undefined;
  const mapped = FONT_FAMILY_BY_WORD_NAME[trimmed.toLowerCase()];
  if (mapped) return mapped;
  // Quote multi-word names; leave simple identifiers bare.
  if (/\s/.test(trimmed)) return `"${trimmed.replace(/"/g, '')}"`;
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

function textAlignFromOffice(node: OfficeContentNode): { textAlign?: string } {
  const meta = node.metadata as { alignment?: string } | undefined;
  const alignment = meta?.alignment ?? node.formatting?.alignment;
  if (
    alignment === 'left' ||
    alignment === 'center' ||
    alignment === 'right' ||
    alignment === 'justify'
  ) {
    return { textAlign: alignment };
  }
  return {};
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

  const textStyleAttrs: Record<string, string> = {};
  const fontSize = normalizeFontSize(
    typeof formatting.size === 'string' ? formatting.size : undefined,
  );
  if (fontSize) textStyleAttrs.fontSize = fontSize;

  const fontFamily = mapWordFontToTipTap(
    typeof formatting.font === 'string' ? formatting.font : undefined,
  );
  if (fontFamily) textStyleAttrs.fontFamily = fontFamily;

  const color = normalizeHexColor(
    typeof formatting.color === 'string' ? formatting.color : undefined,
  );
  if (color) textStyleAttrs.color = color;

  const backgroundColor = normalizeHexColor(
    typeof formatting.backgroundColor === 'string'
      ? formatting.backgroundColor
      : undefined,
  );
  if (backgroundColor) textStyleAttrs.backgroundColor = backgroundColor;

  if (Object.keys(textStyleAttrs).length > 0) {
    marks.push({ type: 'textStyle', attrs: textStyleAttrs });
  }

  return marks.length > 0 ? marks : undefined;
}

type AttachmentLookup = ReadonlyMap<string, OfficeAttachment>;

function estimatedBase64Bytes(base64: string): number {
  // Rough decoded size; ignore whitespace/padding noise.
  return Math.floor((base64.replace(/\s/g, '').length * 3) / 4);
}

function attachmentToDataUrl(attachment: OfficeAttachment): string | undefined {
  if (!attachment.data || estimatedBase64Bytes(attachment.data) > MAX_IMAGE_BYTES) {
    return undefined;
  }
  const mime =
    typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/')
      ? attachment.mimeType
      : `image/${attachment.extension || 'png'}`;
  // Skip formats TipTap / Word export can't round-trip well.
  if (!/^image\/(png|jpe?g|gif|bmp|webp)$/i.test(mime)) return undefined;
  return `data:${mime};base64,${attachment.data}`;
}

function imageNodeToTipTap(
  node: OfficeContentNode,
  attachments: AttachmentLookup,
): JSONContent | null {
  if (node.type !== 'image') return null;
  const meta = node.metadata as
    | { attachmentName?: string; altText?: string; url?: string }
    | undefined;
  const alt = typeof meta?.altText === 'string' ? meta.altText : undefined;

  if (meta?.attachmentName) {
    const attachment = attachments.get(meta.attachmentName);
    if (attachment) {
      const src = attachmentToDataUrl(attachment);
      if (src) return { type: 'image', attrs: { src, alt: alt ?? null } };
    }
  }

  if (typeof meta?.url === 'string' && /^https?:\/\//i.test(meta.url)) {
    return { type: 'image', attrs: { src: meta.url, alt: alt ?? null } };
  }

  return null;
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
    if (current.type === 'image') return;
    current.children?.forEach(visit);
  };

  if (node.children && node.children.length > 0) {
    node.children.forEach(visit);
  } else if (node.text) {
    runs.push({ type: 'text', text: node.text, marks: formattingToMarks(node.formatting) });
  }

  return runs.filter((run) => run.text !== undefined && run.text !== '');
}

/**
 * Paragraph/heading → one or more TipTap blocks. Images nested in the paragraph
 * become sibling image blocks (TipTap Image is block-level in the editor).
 */
function blocksFromParagraphOrHeading(
  node: OfficeContentNode,
  attachments: AttachmentLookup,
): JSONContent[] {
  const indent = indentAttrsFromOffice(node);
  const align = textAlignFromOffice(node);
  const blockAttrs = { ...indent, ...align };
  const isHeading = node.type === 'heading';
  const level = isHeading ? (node.metadata?.level ?? 1) : undefined;

  const makeTextBlock = (textNodes: JSONContent[]): JSONContent => {
    if (isHeading) {
      return {
        type: 'heading',
        attrs: { level, ...blockAttrs },
        content: textNodes.length > 0 ? textNodes : undefined,
      };
    }
    return {
      type: 'paragraph',
      ...(Object.keys(blockAttrs).length > 0 ? { attrs: blockAttrs } : {}),
      content: textNodes.length > 0 ? textNodes : undefined,
    };
  };

  const children = node.children ?? [];
  const hasImageChild = children.some((c) => c.type === 'image');
  if (!hasImageChild) {
    return [makeTextBlock(collectTextRuns(node))];
  }

  const blocks: JSONContent[] = [];
  let pendingText: JSONContent[] = [];
  const flushText = () => {
    if (pendingText.length === 0 && blocks.length > 0) return;
    blocks.push(makeTextBlock(pendingText));
    pendingText = [];
  };

  const visitInline = (current: OfficeContentNode) => {
    if (current.type === 'text' && current.text) {
      pendingText.push({
        type: 'text',
        text: current.text,
        marks: formattingToMarks(current.formatting),
      });
      return;
    }
    if (current.type === 'image') {
      flushText();
      const image = imageNodeToTipTap(current, attachments);
      if (image) blocks.push(image);
      return;
    }
    current.children?.forEach(visitInline);
  };

  children.forEach(visitInline);
  flushText();
  return blocks.length > 0 ? blocks : [makeTextBlock([])];
}

/** Reinterpret a list item as a paragraph node for shared block mapping. */
function listNodeAsParagraph(
  node: OfficeContentNode,
): Extract<OfficeContentNode, { type: 'paragraph' }> {
  const meta = node.metadata as
    | {
        alignment?: string;
        paragraphIndentation?: {
          left?: number;
          firstLine?: number;
          hanging?: number;
        };
      }
    | undefined;
  const alignment =
    meta?.alignment === 'left' ||
    meta?.alignment === 'center' ||
    meta?.alignment === 'right' ||
    meta?.alignment === 'justify'
      ? meta.alignment
      : undefined;
  return {
    type: 'paragraph',
    text: node.text,
    children: node.children,
    formatting: node.formatting,
    comments: node.comments,
    notes: node.notes,
    rawContent: node.rawContent,
    metadata:
      alignment || meta?.paragraphIndentation
        ? {
            ...(alignment ? { alignment } : {}),
            ...(meta?.paragraphIndentation
              ? { paragraphIndentation: meta.paragraphIndentation }
              : {}),
          }
        : undefined,
  };
}

function listItemFromOffice(
  node: OfficeContentNode,
  attachments: AttachmentLookup,
): JSONContent {
  const itemBlocks = blocksFromParagraphOrHeading(
    listNodeAsParagraph(node),
    attachments,
  ).filter((b) => b.type === 'paragraph' || b.type === 'image');
  return {
    type: 'listItem',
    content: itemBlocks.length > 0 ? itemBlocks : [{ type: 'paragraph' }],
  };
}

/**
 * Group consecutive office `list` items into TipTap bulletList / orderedList.
 * Nested levels become nested lists under the previous item when level increases.
 */
function consumeListGroup(
  nodes: OfficeContentNode[],
  startIndex: number,
  attachments: AttachmentLookup,
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
      const nested = consumeListGroup(nodes, i, attachments);
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

    items.push(listItemFromOffice(node, attachments));
    i += 1;
  }

  return {
    blocks: [{ type: listType, content: items }],
    nextIndex: i,
  };
}

function tableFromOffice(
  node: OfficeContentNode,
  attachments: AttachmentLookup,
): JSONContent {
  const rows = (node.children ?? []).filter((child) => child.type === 'row');
  const tipTapRows: JSONContent[] = rows.map((row, rowIndex) => {
    const cells = (row.children ?? []).filter((child) => child.type === 'cell');
    return {
      type: 'tableRow',
      content: cells.map((cell) => {
        const cellBlocks = (cell.children ?? []).flatMap((child) =>
          officeNodesToTiptapBlocks([child], attachments),
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
              b.type === 'orderedList' ||
              b.type === 'image',
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
function officeNodesToTiptapBlocks(
  nodes: OfficeContentNode[],
  attachments: AttachmentLookup,
): JSONContent[] {
  const blocks: JSONContent[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!;
    if (node.type === 'heading' || node.type === 'paragraph') {
      blocks.push(...blocksFromParagraphOrHeading(node, attachments));
      i += 1;
      continue;
    }
    if (node.type === 'list') {
      const group = consumeListGroup(nodes, i, attachments);
      blocks.push(...group.blocks);
      i = group.nextIndex;
      continue;
    }
    if (node.type === 'table') {
      blocks.push(tableFromOffice(node, attachments));
      i += 1;
      continue;
    }
    if (node.type === 'image') {
      const image = imageNodeToTipTap(node, attachments);
      if (image) blocks.push(image);
      i += 1;
      continue;
    }
    if (node.children && node.children.length > 0) {
      blocks.push(...officeNodesToTiptapBlocks(node.children, attachments));
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
  return officeNodesToTiptapBlocks([node], new Map());
}

/**
 * Parses a `.docx` file (as bytes) via `officeparser` and returns Tiptap
 * `JSONContent` suitable for `useEditor({ content })`.
 */
export async function docxBytesToTiptapContent(
  bytes: Uint8Array,
): Promise<JSONContent> {
  try {
    const ast = await OfficeParser.parseOffice(bytes, {
      fileType: 'docx',
      extractAttachments: true,
    });
    const attachments = new Map<string, OfficeAttachment>();
    for (const attachment of ast.attachments ?? []) {
      if (attachment?.name) attachments.set(attachment.name, attachment);
    }
    const blocks = officeNodesToTiptapBlocks(ast.content, attachments);

    return {
      type: 'doc',
      content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
    };
  } catch (error) {
    if (error instanceof DocxClientParseError) throw error;
    const detail = error instanceof Error ? error.message : 'Unknown parse error';
    throw new DocxClientParseError(
      `Could not preserve Word formatting for this file (${detail}). Plain text will be used after server ingest.`,
    );
  }
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

function textStyleAttrs(
  marks: JSONContent['marks'],
): {
  fontSize?: string;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
} {
  const textStyle = marks?.find((m) => m.type === 'textStyle');
  const attrs = textStyle?.attrs ?? {};
  return {
    fontSize: typeof attrs.fontSize === 'string' ? attrs.fontSize : undefined,
    fontFamily: typeof attrs.fontFamily === 'string' ? attrs.fontFamily : undefined,
    color: typeof attrs.color === 'string' ? attrs.color : undefined,
    backgroundColor:
      typeof attrs.backgroundColor === 'string' ? attrs.backgroundColor : undefined,
  };
}

function parseDataImageSrc(
  src: string,
): { type: 'png' | 'jpg' | 'gif' | 'bmp'; data: Uint8Array } | null {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(src.trim());
  if (!match) return null;
  const subtype = match[1]!.toLowerCase();
  const type: 'png' | 'jpg' | 'gif' | 'bmp' =
    subtype === 'jpg' || subtype === 'jpeg' ? 'jpg' : (subtype as 'png' | 'gif' | 'bmp');
  try {
    const binary = atob(match[2]!);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return null;
    return { type, data };
  } catch {
    return null;
  }
}

function imageRunFromTipTap(node: JSONContent): ImageRun | null {
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
  const parsed = parseDataImageSrc(src);
  if (!parsed) return null;
  const width =
    typeof node.attrs?.width === 'number' && node.attrs.width > 0
      ? Math.round(node.attrs.width)
      : DEFAULT_IMAGE_WIDTH_PX;
  const height =
    typeof node.attrs?.height === 'number' && node.attrs.height > 0
      ? Math.round(node.attrs.height)
      : DEFAULT_IMAGE_HEIGHT_PX;
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : undefined;
  return new ImageRun({
    type: parsed.type,
    data: parsed.data,
    transformation: { width, height },
    ...(alt ? { altText: { title: alt, description: alt, name: alt } } : {}),
  });
}

function tiptapInlineContentToRuns(inline: JSONContent[]): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of inline) {
    if (node.type === 'image') {
      const image = imageRunFromTipTap(node);
      if (image) children.push(image);
      continue;
    }
    if (node.type !== 'text' || typeof node.text !== 'string') continue;
    const markTypes = new Set((node.marks ?? []).map((mark) => mark.type));
    const style = textStyleAttrs(node.marks);
    const halfPoints = fontSizeToDocxHalfPoints(style.fontSize);
    const color = hexForDocx(style.color);
    const fill = hexForDocx(style.backgroundColor);
    const font = primaryFontFamily(style.fontFamily);
    children.push(
      new TextRun({
        text: node.text,
        bold: markTypes.has('bold'),
        italics: markTypes.has('italic'),
        underline: markTypes.has('underline') ? {} : undefined,
        strike: markTypes.has('strike'),
        ...(halfPoints ? { size: halfPoints } : {}),
        ...(color ? { color } : {}),
        ...(font ? { font } : {}),
        ...(fill
          ? { shading: { type: ShadingType.CLEAR, fill, color: 'auto' } }
          : {}),
      }),
    );
  }
  return children;
}

function paragraphIndentFromAttrs(
  attrs: Record<string, unknown> | undefined | null,
): { left: number } | undefined {
  const indent = typeof attrs?.indent === 'number' ? attrs.indent : 0;
  if (indent <= 0) return undefined;
  return { left: Math.min(MAX_INDENT_LEVEL, indent) * TWIPS_PER_INDENT_LEVEL };
}

function paragraphAlignmentFromAttrs(
  attrs: Record<string, unknown> | undefined | null,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = typeof attrs?.textAlign === 'string' ? attrs.textAlign : undefined;
  return align ? ALIGNMENT_TO_DOCX[align] : undefined;
}

function blockToDocxParagraph(node: JSONContent): Paragraph {
  const children = tiptapInlineContentToRuns(node.content ?? []);
  const indent = paragraphIndentFromAttrs(node.attrs as Record<string, unknown> | undefined);
  const alignment = paragraphAlignmentFromAttrs(
    node.attrs as Record<string, unknown> | undefined,
  );
  if (node.type === 'heading') {
    const level = Number(node.attrs?.level ?? 1);
    return new Paragraph({
      heading: HEADING_LEVEL_BY_NUMBER[level] ?? HeadingLevel.HEADING_1,
      children,
      ...(indent ? { indent } : {}),
      ...(alignment ? { alignment } : {}),
    });
  }
  return new Paragraph({
    children,
    ...(indent ? { indent } : {}),
    ...(alignment ? { alignment } : {}),
  });
}

function imageBlockToDocxParagraph(node: JSONContent): Paragraph | null {
  const image = imageRunFromTipTap(node);
  if (!image) return null;
  return new Paragraph({ children: [image] });
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
            ...(paragraphAlignmentFromAttrs(
              child.attrs as Record<string, unknown> | undefined,
            )
              ? {
                  alignment: paragraphAlignmentFromAttrs(
                    child.attrs as Record<string, unknown> | undefined,
                  ),
                }
              : {}),
          }),
        );
      } else if (child.type === 'image') {
        const imagePara = imageBlockToDocxParagraph(child);
        if (imagePara) out.push(imagePara);
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
    } else if (block.type === 'image') {
      const imagePara = imageBlockToDocxParagraph(block);
      if (imagePara) paragraphs.push(imagePara);
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
 * Builds a `.docx` as raw bytes from the editor's current `JSONContent`.
 * Prefer this in Node / tests; browsers can wrap with `tiptapContentToDocxBlob`.
 */
export async function tiptapContentToDocxBytes(
  content: JSONContent,
): Promise<Uint8Array> {
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

  const buffer = await Packer.toBuffer(document);
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

/**
 * Builds a `.docx` `Blob` from the editor's current `JSONContent`.
 */
export async function tiptapContentToDocxBlob(
  content: JSONContent,
): Promise<Blob> {
  const bytes = await tiptapContentToDocxBytes(content);
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
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
    } else if (node.type === 'image') {
      const imagePara = imageBlockToDocxParagraph(node);
      if (imagePara) out.push(imagePara);
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
