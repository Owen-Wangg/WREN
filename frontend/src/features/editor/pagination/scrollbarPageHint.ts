/**
 * Maps editor scroll position to a letter-page ordinal for the scrollbar hover hint.
 * Page frames are uniformly sized (US Letter + gap), so the probe is O(1).
 */
import { PAGE_CONFIG } from './types';

/** Fallback hit width when overlay scrollbars report a 0px gutter. */
export const SCROLLBAR_HIT_MIN_PX = 16;

export function pageFromDocumentY(documentY: number, pageCount: number): number {
  const total = Math.max(1, pageCount);
  const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
  const index = Math.floor((documentY - PAGE_CONFIG.PAGE_GAP_PX) / stride);
  return Math.min(total, Math.max(1, index + 1));
}

/** Page occupying the top of the viewport (the page currently shown). */
export function visiblePageFromScroll(scrollEl: HTMLElement, pageCount: number): number {
  const probeY =
    scrollEl.scrollTop + Math.min(scrollEl.clientHeight * 0.2, PAGE_CONFIG.MARGIN_PX);
  return pageFromDocumentY(probeY, pageCount);
}

export function formatPageHint(current: number, pageCount: number): string {
  return `Page ${current} of ${Math.max(1, pageCount)}`;
}

export function isOverVerticalScrollbar(
  scrollEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  if (scrollEl.scrollHeight <= scrollEl.clientHeight + 1) return false;
  const rect = scrollEl.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.bottom) return false;
  const gutter = Math.max(scrollEl.offsetWidth - scrollEl.clientWidth, SCROLLBAR_HIT_MIN_PX);
  return clientX >= rect.right - gutter && clientX <= rect.right;
}
