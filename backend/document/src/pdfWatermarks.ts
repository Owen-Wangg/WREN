/**
 * Drop PDF overlay stamps (CanLII reporter watermarks, huge overlapping type)
 * so they do not land in the editor as giant overlapping text.
 */
import type { SpatialPage, SpatialTextItem } from './pdfToTipTap.js';
import { isCanliiOverlayStamp } from './pdfHeadingHeuristics.js';

function itemSize(item: SpatialTextItem): number {
  return item.fontSize && item.fontSize > 0 ? item.fontSize : item.height || 0;
}

function boxesOverlap(a: SpatialTextItem, b: SpatialTextItem): boolean {
  const aRight = a.x + Math.max(a.width, 1);
  const bRight = b.x + Math.max(b.width, 1);
  const aBottom = a.y + Math.max(a.height, 1);
  const bBottom = b.y + Math.max(b.height, 1);
  const xOverlap = a.x < bRight && b.x < aRight;
  const yOverlap = a.y < bBottom && b.y < aBottom;
  return xOverlap && yOverlap;
}

function medianSize(items: SpatialTextItem[]): number {
  const sizes = items.map(itemSize).filter((s) => s > 0).sort((a, b) => a - b);
  if (sizes.length === 0) return 12;
  return sizes[Math.floor((sizes.length - 1) / 2)] ?? 12;
}

function isHugeOverlay(item: SpatialTextItem, items: SpatialTextItem[], median: number): boolean {
  const size = itemSize(item);
  if (median <= 0 || size < median * 2.2) return false;
  return items.some(
    (other) => other !== item && itemSize(other) < size * 0.6 && boxesOverlap(item, other),
  );
}

function normalizeStamp(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Stamps that repeat on many pages (CanLII overlay) even when they do not
 * geometrically overlap body glyphs in the text layer.
 */
function repeatingOverlayTexts(pages: SpatialPage[]): Set<string> {
  if (pages.length < 2) return new Set();
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const item of page.textItems) {
      const key = normalizeStamp(item.text);
      if (!key || key.length > 80) continue;
      if (!isCanliiOverlayStamp(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  const threshold = Math.min(3, pages.length);
  for (const [text, n] of counts) {
    if (n >= threshold) out.add(text);
  }
  return out;
}

export function filterWatermarkItems(
  items: SpatialTextItem[],
  repeatingStamps: ReadonlySet<string> = new Set(),
): SpatialTextItem[] {
  if (items.length === 0) return items;
  const median = medianSize(items);
  return items.filter((item) => {
    const text = normalizeStamp(item.text);
    if (!text) return false;
    if (isCanliiOverlayStamp(text) || repeatingStamps.has(text)) return false;
    if (isHugeOverlay(item, items, median)) return false;
    return true;
  });
}

export function filterWatermarkPages(pages: SpatialPage[]): SpatialPage[] {
  const repeating = repeatingOverlayTexts(pages);
  return pages.map((page) => ({
    textItems: filterWatermarkItems(page.textItems, repeating),
  }));
}
