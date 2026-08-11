/**
 * Combined document + AI Debrief PDF export.
 *
 * Download PDF (`tiptapContentToPdfBlob`) still exports the editor only.
 * This module builds a two-column letter PDF: document on the left, debrief
 * on the right — matching the editor UI — and paginates by capturing
 * page-sized windows so long content is not clipped and canvas size stays safe.
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import { wordCountFromTipTapContent } from '@wren/types';
import { tiptapContentToHtml } from './pdfExport';

import type { JSONContent } from '@tiptap/react';
import type { Debrief, ProgressPattern } from '@/features/debrief/debriefTypes';
import type { FeedbackItem } from '@wren/types';

export type CombinedDebriefStatus = 'ready' | 'empty' | 'unavailable';

export interface CombinedPdfExportInput {
  readonly content: JSONContent;
  readonly documentTitle: string;
  readonly exportDate: Date;
  readonly debrief: Debrief | null;
  readonly debriefStatus: CombinedDebriefStatus;
}

/** Letter width at 96dpi. Height is the content band; a footer band is left for page numbers. */
const CSS_PAGE_WIDTH = 816;
const CSS_PAGE_HEIGHT = 1024;
const PDF_FOOTER_BAND_PT = 24;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isEditorContentEmpty(content: JSONContent): boolean {
  return wordCountFromTipTapContent(content) === 0;
}

export function formatExportDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function tendencyLabel(tendency: ProgressPattern['tendency']): string {
  if (tendency === 'nearly_resolved') return 'nearly there';
  return tendency;
}

function renderProgressHtml(patterns: readonly ProgressPattern[]): string {
  if (patterns.length === 0) return '';

  const counts = {
    improving: patterns.filter((p) => p.tendency === 'improving').length,
    persistent: patterns.filter((p) => p.tendency === 'persistent').length,
    nearly_resolved: patterns.filter((p) => p.tendency === 'nearly_resolved').length,
    emerging: patterns.filter((p) => p.tendency === 'emerging').length,
  };

  const countParts = [
    counts.improving > 0 ? `${counts.improving} Improving` : '',
    counts.persistent > 0 ? `${counts.persistent} Persistent` : '',
    counts.nearly_resolved > 0 ? `${counts.nearly_resolved} Nearly there` : '',
    counts.emerging > 0 ? `${counts.emerging} Emerging` : '',
  ].filter(Boolean);

  const patternCards = patterns
    .map((pattern) => {
      return `<div style="margin:0 0 8px;padding:8px;border:1px solid #e5e5e5;border-radius:6px;background:#fafafa;">
        <div style="font-weight:600;font-size:10px;margin-bottom:2px;">
          ${escapeHtml(pattern.category)}
          <span style="font-weight:500;color:#555;"> · ${escapeHtml(tendencyLabel(pattern.tendency))}</span>
        </div>
        <div style="font-size:10px;line-height:1.45;color:#333;">${escapeHtml(pattern.description)}</div>
      </div>`;
    })
    .join('');

  return `<section style="margin:0 0 14px;">
    <h3 style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.02em;">Your Progress This Draft</h3>
    ${countParts.length ? `<p style="margin:0 0 8px;font-size:10px;color:#333;">${escapeHtml(countParts.join('  ·  '))}</p>` : ''}
    ${patternCards}
  </section>`;
}

function renderStrengthItem(item: FeedbackItem): string {
  if (!item.positiveNote) return '';
  const quote = item.quotedText
    ? `<div style="margin:6px 0 0 16px;">
        <div style="font-size:9px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#2f6f4e;">Where you did this well</div>
        <blockquote style="margin:4px 0 0;padding:4px 0 4px 10px;border-left:2px solid #6aa88a;font-style:italic;color:#444;">“${escapeHtml(item.quotedText)}”</blockquote>
      </div>`
    : '';
  return `<li style="margin:0 0 8px;padding:8px;border-radius:6px;background:#f3faf6;list-style:none;">
    <div>✓ ${escapeHtml(item.positiveNote)}</div>
    ${quote}
  </li>`;
}

function renderImprovementItem(item: FeedbackItem): string {
  const quote = item.quotedText
    ? `<div style="margin:6px 0 0;">
        <div style="font-size:9px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#9a6b24;">One example — check your whole draft for this</div>
        <blockquote style="margin:4px 0 0;padding:4px 0 4px 10px;border-left:2px solid #d4a017;font-style:italic;color:#444;">“${escapeHtml(item.quotedText)}”</blockquote>
      </div>`
    : '';
  const citation = item.citationReferenceId
    ? `<div style="margin-top:6px;font-size:9px;font-style:italic;color:#888;">Source informed by reference material</div>`
    : '';
  return `<li style="margin:0 0 12px;list-style:none;">
    <p style="margin:0;font-weight:600;">${escapeHtml(item.questionText)}</p>
    ${quote}
    ${citation}
  </li>`;
}

export function renderDebriefColumnHtml(
  debrief: Debrief | null,
  status: CombinedDebriefStatus,
): string {
  if (status !== 'ready' || !debrief || debrief.items.length === 0) {
    const message =
      status === 'unavailable'
        ? 'AI Debrief could not be loaded. Generate or regenerate feedback, then export again.'
        : 'AI Debrief has not been generated yet. Click Regenerate in the AI Debrief panel, then export again to include feedback.';
    return `<div data-pdf-debrief-empty="true">
      <h2 style="margin:0 0 10px;font-size:13px;font-weight:700;">AI Debrief</h2>
      <p style="margin:0;font-size:11px;line-height:1.5;color:#555;">${escapeHtml(message)}</p>
    </div>`;
  }

  const categoryOrder: string[] = [];
  const strengthsByCategory: Record<string, FeedbackItem[]> = {};
  const improvementsByCategory: Record<string, FeedbackItem[]> = {};
  for (const item of debrief.items) {
    const cat = item.errorCategoryId;
    if (!categoryOrder.includes(cat)) categoryOrder.push(cat);
    if (item.kind === 'strength') {
      (strengthsByCategory[cat] ??= []).push(item);
    } else {
      (improvementsByCategory[cat] ??= []).push(item);
    }
  }

  const sections = categoryOrder
    .map((category) => {
      const strengths = strengthsByCategory[category] ?? [];
      const improvements = improvementsByCategory[category] ?? [];
      if (strengths.length === 0 && improvements.length === 0) return '';
      const label = debrief.categoryNames?.[category] ?? category;
      const strengthHtml = strengths.map(renderStrengthItem).join('');
      const improvementHtml = improvements.map(renderImprovementItem).join('');
      return `<section style="margin:0 0 16px;">
        <h3 style="margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd;font-size:11px;font-weight:700;">${escapeHtml(label)}</h3>
        ${
          strengthHtml
            ? `<h4 style="margin:0 0 6px;font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#2f6f4e;">What's Done Well</h4>
               <ul style="margin:0 0 12px;padding:0;">${strengthHtml}</ul>`
            : ''
        }
        ${
          improvementHtml
            ? `<h4 style="margin:0 0 6px;font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#9a6b24;">Areas for Improvement</h4>
               <ul style="margin:0;padding:0;">${improvementHtml}</ul>`
            : ''
        }
      </section>`;
    })
    .join('');

  const generated = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(debrief.generatedAt));
    } catch {
      return '';
    }
  })();

  return `<div data-pdf-debrief="true">
    <h2 style="margin:0 0 4px;font-size:13px;font-weight:700;">AI Debrief</h2>
    ${generated ? `<p style="margin:0 0 12px;font-size:9px;color:#777;">Generated ${escapeHtml(generated)}</p>` : ''}
    ${renderProgressHtml(debrief.progressSummary ?? [])}
    ${sections}
  </div>`;
}

export function buildCombinedExportHtml(input: CombinedPdfExportInput): string {
  const title = escapeHtml(input.documentTitle.trim() || 'Untitled document');
  const dateLabel = escapeHtml(formatExportDate(input.exportDate));
  const documentHtml = tiptapContentToHtml(input.content);
  const debriefHtml = renderDebriefColumnHtml(input.debrief, input.debriefStatus);

  return `<div data-combined-pdf="true">
    <header data-pdf-export-header="true" style="margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid #ccc;">
      <div style="font-size:16px;font-weight:700;line-height:1.3;color:#111;">${title}</div>
      <div style="margin-top:4px;font-size:10px;color:#666;">Exported ${dateLabel}</div>
    </header>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>
        <td data-pdf-doc="true" style="width:58%;vertical-align:top;padding:0 16px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:12px;line-height:1.5;color:#111;">
          ${documentHtml}
        </td>
        <td data-pdf-debrief-col="true" style="width:42%;vertical-align:top;padding:0 0 0 16px;border-left:1px solid #e2e2e2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:11px;line-height:1.45;color:#111;">
          ${debriefHtml}
        </td>
      </tr>
    </table>
  </div>`;
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );
}

/**
 * Render the editor + debrief into a multi-page letter PDF.
 * Page 1 includes the title/date header; later pages keep the two-column grid.
 */
export async function combinedDocumentAndDebriefToPdfBlob(
  input: CombinedPdfExportInput,
): Promise<Blob> {
  const shell = document.createElement('div');
  shell.setAttribute('data-pdf-export', 'combined');
  shell.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${CSS_PAGE_WIDTH}px`,
    `height:${CSS_PAGE_HEIGHT}px`,
    'overflow:hidden',
    'background:#fff',
    'color:#111',
    'box-sizing:border-box',
  ].join(';');

  const inner = document.createElement('div');
  inner.style.cssText = [
    `width:${CSS_PAGE_WIDTH}px`,
    'box-sizing:border-box',
    'padding:40px 36px 48px',
    'background:#fff',
  ].join(';');
  inner.innerHTML = buildCombinedExportHtml(input);

  const style = document.createElement('style');
  style.textContent = `
    [data-pdf-doc] h1 { font-size: 20px; margin: 0 0 10px; font-weight: 700; }
    [data-pdf-doc] h2 { font-size: 16px; margin: 16px 0 8px; font-weight: 700; }
    [data-pdf-doc] h3 { font-size: 13px; margin: 14px 0 6px; font-weight: 700; }
    [data-pdf-doc] p { margin: 0 0 10px; }
    [data-pdf-doc] ul, [data-pdf-doc] ol { margin: 0 0 10px; padding-left: 1.4em; }
    [data-pdf-doc] li { margin: 0 0 4px; }
    [data-pdf-doc] blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid #ccc; color: #444; }
    [data-pdf-doc] table { margin: 0 0 10px; }
  `;

  shell.appendChild(style);
  shell.appendChild(inner);
  document.body.appendChild(shell);

  try {
    await waitForImages(inner);
    const totalHeight = Math.max(inner.scrollHeight, CSS_PAGE_HEIGHT);
    const pageCount = Math.max(1, Math.ceil(totalHeight / CSS_PAGE_HEIGHT));

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      inner.style.transform = `translateY(${-pageIndex * CSS_PAGE_HEIGHT}px)`;
      const canvas = await html2canvas(shell, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: CSS_PAGE_WIDTH,
        height: CSS_PAGE_HEIGHT,
        windowWidth: CSS_PAGE_WIDTH,
        windowHeight: CSS_PAGE_HEIGHT,
      });

      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        0,
        0,
        pageWidth,
        pageHeight - PDF_FOOTER_BAND_PT,
      );

      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text(`${pageIndex + 1} / ${pageCount}`, pageWidth / 2, pageHeight - 10, {
        align: 'center',
      });
      pdf.setTextColor(0, 0, 0);
    }

    return pdf.output('blob');
  } finally {
    shell.remove();
  }
}
