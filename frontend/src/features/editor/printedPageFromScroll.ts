/**
 * Map continuous-editor scroll onto the printed-page estimate.
 * Does not introduce live pagination — same letter-page count as the header.
 */

const MIN_THUMB_PX = 24;

export function clampPrintedPageCount(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount < 1) return 1;
  return Math.max(1, Math.round(pageCount));
}

/** Page at the top of the viewport (1-based), given estimated letter pages. */
export function printedPageFromScroll(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  pageCount: number,
): number {
  const pages = clampPrintedPageCount(pageCount);
  if (scrollHeight <= 0 || pages === 1) return 1;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (maxScroll <= 0) return 1;
  if (scrollTop >= maxScroll - 1) return pages;
  const pageHeight = scrollHeight / pages;
  return Math.min(pages, Math.max(1, Math.floor(Math.max(0, scrollTop) / pageHeight) + 1));
}

export function formatPrintedPageHint(current: number, pageCount: number): string {
  const pages = clampPrintedPageCount(pageCount);
  const page = Math.min(pages, Math.max(1, Math.round(current) || 1));
  return `Page ${page} of ${pages}`;
}

/** Vertical center of the native scrollbar thumb, relative to the scrollport. */
export function scrollThumbCenterY(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  if (clientHeight <= 0) return 0;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const thumbHeight = Math.min(
    clientHeight,
    Math.max(MIN_THUMB_PX, (clientHeight / Math.max(scrollHeight, 1)) * clientHeight),
  );
  const track = Math.max(0, clientHeight - thumbHeight);
  const ratio = maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, scrollTop / maxScroll));
  return ratio * track + thumbHeight / 2;
}

export function isPointInScrollbarGutter(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'top' | 'right' | 'bottom'>,
  hitPx: number,
): boolean {
  return (
    clientX >= rect.right - hitPx &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}
