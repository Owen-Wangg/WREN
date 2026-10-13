/**
 * Minimal, dependency-free PDF writer for tests.
 *
 * Produces real PDF bytes that pdf.js can parse, so tests exercise the actual
 * text-layer path instead of a fake loader. Supports the standard 14 Helvetica
 * faces, positioned / rotated text, and grayscale image XObjects.
 *
 * Coordinates are top-origin (y grows downward) in PDF points, matching the
 * `SpatialTextItem` convention. Text `y` is the baseline.
 */

export type PdfFontStyle = 'regular' | 'bold' | 'italic';

export interface PdfTextSpec {
  readonly text: string;
  readonly x: number;
  /** Baseline distance from the top of the page. */
  readonly y: number;
  readonly size?: number;
  readonly font?: PdfFontStyle;
  /** Counter-clockwise rotation in degrees (90 = vertical margin stamp). */
  readonly rotate?: 0 | 90;
}

export interface PdfImageSpec {
  readonly x: number;
  /** Top edge distance from the top of the page. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPageSpec {
  readonly width?: number;
  readonly height?: number;
  readonly texts?: readonly PdfTextSpec[];
  readonly images?: readonly PdfImageSpec[];
}

const FONT_RESOURCES: Record<PdfFontStyle, { readonly key: string; readonly base: string }> = {
  regular: { key: 'F1', base: 'Helvetica' },
  bold: { key: 'F2', base: 'Helvetica-Bold' },
  italic: { key: 'F3', base: 'Helvetica-Oblique' },
};

function escapePdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function pageContentStream(page: PdfPageSpec, height: number): string {
  const ops: string[] = [];
  (page.images ?? []).forEach((img, i) => {
    const bottom = height - img.y - img.height;
    ops.push(
      `q ${num(img.width)} 0 0 ${num(img.height)} ${num(img.x)} ${num(bottom)} cm /Im${i + 1} Do Q`,
    );
  });
  for (const t of page.texts ?? []) {
    const size = t.size ?? 12;
    const font = FONT_RESOURCES[t.font ?? 'regular'];
    const baseline = height - t.y;
    const matrix =
      t.rotate === 90
        ? `0 1 -1 0 ${num(t.x)} ${num(baseline)}`
        : `1 0 0 1 ${num(t.x)} ${num(baseline)}`;
    ops.push(`BT /${font.key} ${num(size)} Tf ${matrix} Tm (${escapePdfString(t.text)}) Tj ET`);
  }
  return ops.join('\n');
}

/** Build a PDF from page specs. Returns raw bytes as a Node Buffer. */
export function buildPdf(pages: readonly PdfPageSpec[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add('');
  const pagesId = add('');
  const fontIds: Record<PdfFontStyle, number> = {
    regular: add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`),
    bold: add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`),
    italic: add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>`,
    ),
  };
  const fontDict = (Object.keys(FONT_RESOURCES) as PdfFontStyle[])
    .map((style) => `/${FONT_RESOURCES[style].key} ${fontIds[style]} 0 R`)
    .join(' ');

  const pageIds: number[] = [];
  for (const page of pages) {
    const width = page.width ?? 612;
    const height = page.height ?? 792;

    const imageRefs: string[] = [];
    (page.images ?? []).forEach((_img, i) => {
      // 2×2 mid-gray image; the CTM scales it to the requested rectangle.
      const data = '\x80\x60\x60\x80';
      const imgId = add(
        `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray ` +
          `/BitsPerComponent 8 /Length ${data.length} >>\nstream\n${data}\nendstream`,
      );
      imageRefs.push(`/Im${i + 1} ${imgId} 0 R`);
    });

    const stream = pageContentStream(page, height);
    const contentId = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
    const xobjects = imageRefs.length > 0 ? ` /XObject << ${imageRefs.join(' ')} >>` : '';
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
        `/Resources << /Font << ${fontDict} >>${xobjects} >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n\r\n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
