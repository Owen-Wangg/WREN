/**
 * Client-side TipTap → PDF export via HTML render + html2canvas + jsPDF.
 *
 * Header/footer are drawn programmatically on every page using jsPDF's text API
 * after the body image is sliced. Page-number and date tokens in the
 * header/footer TipTap JSON are resolved at draw time.
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import type { JSONContent } from '@tiptap/react';

import { capInlineFontSize } from './tiptapFontSize';

export interface PdfExportOptions {
  /** TipTap JSON for the repeating page header; null/undefined = no header. */
  readonly header?: JSONContent | null;
  /** TipTap JSON for the repeating page footer; null/undefined = no footer. */
  readonly footer?: JSONContent | null;
  /**
   * ISO timestamp of when the document content was last edited.
   * Used to resolve dateNode chips. Falls back to empty string when absent.
   * Never use new Date() here — the timestamp must come from the stored draft.
   */
  readonly lastEditedAt?: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markOpen(type: string, attrs?: Record<string, unknown>): string {
  switch (type) {
    case 'bold':
      return '<strong>';
    case 'italic':
      return '<em>';
    case 'underline':
      return '<u>';
    case 'strike':
      return '<s>';
    case 'highlight':
      return `<span style="background-color:${String(attrs?.color ?? '#ffff00')}">`;
    case 'textStyle': {
      const parts: string[] = [];
      if (attrs?.color) parts.push(`color:${String(attrs.color)}`);
      if (attrs?.fontSize) parts.push(`font-size:${capInlineFontSize(String(attrs.fontSize))}`);
      if (attrs?.fontFamily) parts.push(`font-family:${String(attrs.fontFamily)}`);
      return parts.length ? `<span style="${parts.join(';')}">` : '<span>';
    }
    default:
      return '';
  }
}

function markClose(type: string): string {
  switch (type) {
    case 'bold':
      return '</strong>';
    case 'italic':
      return '</em>';
    case 'underline':
      return '</u>';
    case 'strike':
      return '</s>';
    case 'highlight':
    case 'textStyle':
      return '</span>';
    default:
      return '';
  }
}

function renderInline(node: JSONContent): string {
  if (node.type === 'text') {
    const text = escapeHtml(node.text ?? '');
    const marks = node.marks ?? [];
    const open = marks.map((m) => markOpen(m.type, m.attrs as Record<string, unknown>)).join('');
    const close = [...marks].reverse().map((m) => markClose(m.type)).join('');
    return `${open}${text}${close}`;
  }
  if (node.type === 'hardBreak') return '<br/>';
  if (node.type === 'image') {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
    if (!src) return '';
    const alt = typeof node.attrs?.alt === 'string' ? escapeHtml(node.attrs.alt) : '';
    return `<img src="${src}" alt="${alt}" style="max-width:100%;height:auto;" />`;
  }
  return (node.content ?? []).map(renderInline).join('');
}

function alignStyle(attrs?: Record<string, unknown> | null): string {
  const align = typeof attrs?.textAlign === 'string' ? attrs.textAlign : 'left';
  const indent =
    typeof attrs?.indent === 'number' && attrs.indent > 0
      ? `margin-left:${attrs.indent * 24}px;`
      : '';
  return `text-align:${align};${indent}`;
}

/** Render TipTap JSON to an HTML fragment (headings, marks, lists, tables). */
export function tiptapContentToHtml(content: JSONContent): string {
  return renderNode(content);
}

function renderNode(node: JSONContent): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(renderNode).join('');
    case 'paragraph':
      return `<p style="${alignStyle(node.attrs)}">${renderInline(node) || '<br/>'}</p>`;
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `<h${level} style="${alignStyle(node.attrs)}">${renderInline(node)}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${(node.content ?? []).map(renderNode).join('')}</ul>`;
    case 'orderedList':
      return `<ol>${(node.content ?? []).map(renderNode).join('')}</ol>`;
    case 'listItem':
      return `<li>${(node.content ?? []).map(renderNode).join('')}</li>`;
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map(renderNode).join('')}</blockquote>`;
    case 'table':
      return `<table style="border-collapse:collapse;width:100%;">${(node.content ?? [])
        .map(renderNode)
        .join('')}</table>`;
    case 'tableRow':
      return `<tr>${(node.content ?? []).map(renderNode).join('')}</tr>`;
    case 'tableHeader':
      return `<th style="border:1px solid #ccc;padding:6px;text-align:left;">${(node.content ?? [])
        .map(renderNode)
        .join('')}</th>`;
    case 'tableCell':
      return `<td style="border:1px solid #ccc;padding:6px;">${(node.content ?? [])
        .map(renderNode)
        .join('')}</td>`;
    case 'image':
      return renderInline(node);
    default:
      return (node.content ?? []).map(renderNode).join('');
  }
}

/**
 * Extract plain text from a header/footer TipTap doc, resolving pageNumber
 * and date node chips as placeholder tokens for later substitution.
 *
 * Returns an array of text segments with optional `{type}` token markers so
 * the caller can stamp the right value at page-draw time.
 */
type TextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'pageNumber' }
  | { kind: 'date' };

function extractHFSegments(node: JSONContent): TextSegment[] {
  if (!node) return [];
  if (node.type === 'pageNumber') return [{ kind: 'pageNumber' }];
  if (node.type === 'date') return [{ kind: 'date' }];
  if (node.type === 'text') return [{ kind: 'text', value: node.text ?? '' }];
  if (node.type === 'hardBreak') return [{ kind: 'text', value: ' ' }];
  return (node.content ?? []).flatMap(extractHFSegments);
}

function resolveHFText(
  doc: JSONContent | null | undefined,
  pageNum: number,
  totalPages: number,
  dateStr: string,
): string {
  if (!doc) return '';
  return extractHFSegments(doc)
    .map((seg) => {
      if (seg.kind === 'pageNumber') return `Page ${pageNum} of ${totalPages}`;
      if (seg.kind === 'date') return dateStr;
      return seg.value;
    })
    .join('')
    .trim();
}

function formatLastEditedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Offscreen HTML host width — 8.5in at 96dpi, matching US Letter PDF export. */
export const PDF_HOST_WIDTH_PX = 816;
/** jsPDF letter size in points. */
const PDF_PAGE_WIDTH_PT = 612;
const PDF_PAGE_HEIGHT_PT = 792;
/** Used as both CSS px padding and PDF pt margin (existing exporter convention). */
const SIDE_MARGIN = 36;
const BASE_VERTICAL_MARGIN = 36;
const HEADER_BAND = 20;
const FOOTER_BAND = 20;
const IMAGE_WAIT_MS = 1500;

/**
 * Convert a rendered export-host height into a US Letter page count using the
 * same slice geometry as {@link tiptapContentToPdfBlob}.
 */
export function printedPageCountFromHostHeight(hostHeightPx: number): number {
  if (!Number.isFinite(hostHeightPx) || hostHeightPx <= 0) return 1;
  const usableWidthPt = PDF_PAGE_WIDTH_PT - SIDE_MARGIN * 2;
  const usableHeightPt = PDF_PAGE_HEIGHT_PT - SIDE_MARGIN * 2;
  const imgHeightPt = (hostHeightPx * usableWidthPt) / PDF_HOST_WIDTH_PX;
  return Math.max(1, Math.ceil(imgHeightPt / usableHeightPt));
}

function createPdfExportHost(content: JSONContent, options?: PdfExportOptions): HTMLDivElement {
  const top = BASE_VERTICAL_MARGIN + (options?.header != null ? HEADER_BAND : 0);
  const bottom = BASE_VERTICAL_MARGIN + (options?.footer != null ? FOOTER_BAND : 0);
  const host = document.createElement('div');
  host.setAttribute('data-pdf-export', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${PDF_HOST_WIDTH_PX}px`,
    `padding:${top}px ${SIDE_MARGIN}px ${bottom}px`,
    'background:#fff',
    'color:#111',
    'font-family:Georgia,"Times New Roman",serif',
    'font-size:12pt',
    'line-height:1.5',
    'box-sizing:border-box',
  ].join(';');
  host.innerHTML = tiptapContentToHtml(content);
  return host;
}

function waitForHostImages(host: HTMLElement): Promise<void> {
  const images = Array.from(host.querySelectorAll('img'));
  if (images.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(
      images.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              }),
      ),
    ).then(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, IMAGE_WAIT_MS);
    }),
  ]);
}

/**
 * Cheap printed-page estimate: same offscreen host as PDF export, no canvas.
 * Does not mutate the live editor. Safe to call on a debounce.
 */
export async function estimatePrintedPageCount(
  content: JSONContent,
  options?: PdfExportOptions,
): Promise<number> {
  const host = createPdfExportHost(content, options);
  document.body.appendChild(host);
  try {
    await waitForHostImages(host);
    return printedPageCountFromHostHeight(host.offsetHeight);
  } finally {
    host.remove();
  }
}

/**
 * Render TipTap JSON to a PDF Blob (letter size, multi-page).
 * Header and footer are drawn programmatically on every page.
 */
export async function tiptapContentToPdfBlob(
  content: JSONContent,
  options?: PdfExportOptions,
): Promise<Blob> {
  const hasHeader = options?.header != null;
  const hasFooter = options?.footer != null;
  const dateStr = formatLastEditedAt(options?.lastEditedAt);

  const host = createPdfExportHost(content, options);
  document.body.appendChild(host);

  try {
    await waitForHostImages(host);
    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - SIDE_MARGIN * 2;
    const usableHeight = pageHeight - SIDE_MARGIN * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const totalPages = Math.max(1, Math.ceil(imgHeight / usableHeight));

    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    let heightLeft = imgHeight;
    let imgPosition = SIDE_MARGIN;
    let pageIndex = 0;

    const drawHeaderFooter = (pgNum: number) => {
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);

      if (hasHeader) {
        const text = resolveHFText(options!.header, pgNum, totalPages, dateStr);
        if (text) {
          pdf.text(text, SIDE_MARGIN, SIDE_MARGIN - 6, { baseline: 'bottom' });
        }
      }

      if (hasFooter) {
        const text = resolveHFText(options!.footer, pgNum, totalPages, dateStr);
        if (text) {
          pdf.text(text, SIDE_MARGIN, pageHeight - SIDE_MARGIN + 6, { baseline: 'top' });
        }
      }

      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(12);
    };

    pdf.addImage(imgData, 'JPEG', SIDE_MARGIN, imgPosition, imgWidth, imgHeight);
    drawHeaderFooter(pageIndex + 1);
    heightLeft -= usableHeight;
    pageIndex += 1;

    while (heightLeft > 0) {
      imgPosition = SIDE_MARGIN - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', SIDE_MARGIN, imgPosition, imgWidth, imgHeight);
      drawHeaderFooter(pageIndex + 1);
      heightLeft -= usableHeight;
      pageIndex += 1;
    }

    return pdf.output('blob');
  } finally {
    host.remove();
  }
}
