/**
 * Minimal hand-crafted PDF byte fixtures for LiteParse tests.
 * No external .pdf assets or PDF-writing library required.
 */

function assemblePdf(objs: string[]): Buffer {
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = body.length;
    body += objs[i]!;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

function contentObj(stream: string, objectNumber: number): string {
  return (
    `${objectNumber} 0 obj\n<< /Length ${stream.length} >>\nstream\n` +
    `${stream}endstream\nendobj\n`
  );
}

/**
 * Two Helvetica lines separated by `gapPt` PDF points (large gap → blank line
 * in LiteParse plain text).
 */
export function buildTextPdf(gapPt: number): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> ' +
    '/MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
  objs[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const secondLineY = 700 - gapPt;
  const stream =
    'BT /F1 12 Tf 72 700 Td (First paragraph text.) Tj ET\n' +
    `BT /F1 12 Tf 72 ${secondLineY} Td (Second paragraph text.) Tj ET\n`;
  objs[5] = contentObj(stream, 5);
  return assemblePdf(objs);
}

/** Valid page with no content stream (no recoverable text without OCR). */
export function buildNoTextLayerPdf(): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n';
  return assemblePdf(objs);
}

/** Large title + body — expects heading then paragraph in TipTap. */
export function buildHeadingBodyPdf(): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> ' +
    '/MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
  objs[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const stream =
    'BT /F1 22 Tf 72 720 Td (Document Title) Tj ET\n' +
    'BT /F1 11 Tf 72 680 Td (Body paragraph under the title.) Tj ET\n';
  objs[5] = contentObj(stream, 5);
  return assemblePdf(objs);
}

/** Mixed Helvetica + Helvetica-Bold on one line — expects a bold mark. */
export function buildInlineBoldPdf(): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> ' +
    '/MediaBox [0 0 612 792] /Contents 6 0 R >>\nendobj\n';
  objs[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  objs[5] = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n';
  const stream =
    'BT /F1 12 Tf 72 700 Td (Hello ) Tj /F2 12 Tf (world) Tj /F1 12 Tf ( body.) Tj ET\n';
  objs[6] = contentObj(stream, 6);
  return assemblePdf(objs);
}

/** Two bullet lines — expects a bulletList with two items. */
export function buildBulletListPdf(): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> ' +
    '/MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
  objs[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  // Use ASCII "*" which our mapper treats as a bullet prefix.
  const stream =
    'BT /F1 12 Tf 72 700 Td (* First list item) Tj ET\n' +
    'BT /F1 12 Tf 72 680 Td (* Second list item) Tj ET\n';
  objs[5] = contentObj(stream, 5);
  return assemblePdf(objs);
}

/** Flush + indented body lines — expects indent attrs on the second block. */
export function buildIndentedParagraphPdf(): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> ' +
    '/MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
  objs[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const stream =
    'BT /F1 12 Tf 72 700 Td (Flush left body line.) Tj ET\n' +
    'BT /F1 12 Tf 144 660 Td (Indented body line here.) Tj ET\n';
  objs[5] = contentObj(stream, 5);
  return assemblePdf(objs);
}
