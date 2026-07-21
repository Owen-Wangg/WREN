/**
 * Browser-side PDF text extraction using pdfjs-dist.
 * Extracts text content page by page and converts to a Tiptap JSONContent doc
 * using the same paragraph structure as docxContentMapper.
 */
import type { JSONContent } from '@tiptap/react';

export async function pdfBytesToTiptapContent(bytes: Uint8Array): Promise<JSONContent> {
  const pdfjsLib = await import('pdfjs-dist');
  // Use the bundled worker to avoid cross-origin worker issues in Vite
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const paragraphs: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    let pageText = '';
    let lastY: number | null = null;

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const y = (item as any).transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
        if (pageText.trim()) {
          paragraphs.push(pageText.trim());
        }
        pageText = item.str;
      } else {
        pageText += item.str;
      }
      lastY = y;
    }
    if (pageText.trim()) {
      paragraphs.push(pageText.trim());
    }
  }

  const content: JSONContent[] = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    }));

  return { type: 'doc', content };
}
