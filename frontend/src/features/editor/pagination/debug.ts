/**
 * Pagination debug instrumentation.
 *
 * All logging in the pagination layer is gated behind this flag so it is inert
 * in normal use. Enable from the browser console:
 *
 * ```js
 * window.__PAGINATION_DEBUG = true
 * ```
 *
 * This exists to diagnose layout/scroll issues against real browser metrics
 * rather than reasoning about them from the source alone.
 */

/** True when pagination debug logging is enabled for this session. */
export function paginationDebug(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__PAGINATION_DEBUG === true
  );
}

/** Scroll metrics captured around a pagination mutation window. */
export interface ScrollSnapshot {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** Largest valid scrollTop for these metrics. */
  maxScrollTop: number;
}

export function snapshotScroll(el: HTMLElement): ScrollSnapshot {
  const { scrollTop, scrollHeight, clientHeight } = el;
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    maxScrollTop: Math.max(0, scrollHeight - clientHeight),
  };
}

/**
 * Logs a scroll snapshot pair, flagging the two ways scroll position gets
 * destroyed by a relayout: the browser clamping `scrollTop` when the document
 * transiently shrinks, and scroll anchoring moving it for us.
 */
export function logScrollDelta(
  label: string,
  before: ScrollSnapshot,
  after: ScrollSnapshot,
  restoredTo: number | null,
): void {
  if (!paginationDebug()) return;

  const drifted = Math.abs(after.scrollTop - before.scrollTop) > 0.5;
  const wasClamped = before.scrollTop > after.maxScrollTop + 0.5;

  console.warn(
    `[PAGINATION-DEBUG] scroll ${label}:\n` +
      `  scrollTop:    ${before.scrollTop} → ${after.scrollTop}` +
      `${drifted ? '  <<< MOVED' : '  (stable)'}\n` +
      `  scrollHeight: ${before.scrollHeight} → ${after.scrollHeight}` +
      `${after.scrollHeight < before.scrollHeight ? '  (shrank)' : ''}\n` +
      `  maxScrollTop: ${before.maxScrollTop} → ${after.maxScrollTop}\n` +
      (wasClamped
        ? `  >>> CLAMPED: prior scrollTop ${before.scrollTop} exceeded the new max ` +
          `${after.maxScrollTop}, so the browser forced it down. This is the ` +
          `jump-to-bottom mechanism.\n`
        : '') +
      `  restored to:  ${restoredTo === null ? 'not restored' : restoredTo}`,
  );
}
