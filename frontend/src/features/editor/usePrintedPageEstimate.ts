/**
 * Debounced US Letter page-count estimate from an offscreen HTML snapshot.
 * Never touches the live ProseMirror editor.
 */
import { useEffect, useState } from 'react';

import { estimatePrintedPageCount } from './pdfExport';

import type { JSONContent } from '@tiptap/react';

const DEBOUNCE_MS = 500;

export function usePrintedPageEstimate(
  content: JSONContent,
  header?: JSONContent | null,
  footer?: JSONContent | null,
): number {
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void estimatePrintedPageCount(content, { header, footer }).then((next) => {
        if (!cancelled) setPageCount(next);
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [content, header, footer]);

  return pageCount;
}
