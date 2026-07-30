/**
 * Client-side TipTap → PDF export via HTML render + html2canvas + jsPDF.
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import type { JSONContent } from '@tiptap/react';

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
      if (attrs?.fontSize) parts.push(`font-size:${String(attrs.fontSize)}`);
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
 * Render TipTap JSON to a PDF Blob (letter size, multi-page).
 */
export async function tiptapContentToPdfBlob(content: JSONContent): Promise<Blob> {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-export', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:816px',
    'padding:48px',
    'background:#fff',
    'color:#111',
    'font-family:Georgia,"Times New Roman",serif',
    'font-size:12pt',
    'line-height:1.5',
    'box-sizing:border-box',
  ].join(';');
  host.innerHTML = renderNode(content);
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    pdf.addImage(imgData, 'JPEG', margin, position, imgWidth, imgHeight);
    heightLeft -= usableHeight;

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;
    }

    return pdf.output('blob');
  } finally {
    host.remove();
  }
}
