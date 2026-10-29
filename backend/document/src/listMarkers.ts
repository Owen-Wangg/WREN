/**
 * List-marker parsing shared by the digital-PDF and Textract import paths.
 *
 * PDFs carry list numbering as literal text ("3.", "b)", "iv."). The marker is
 * stripped from the item text and turned into `orderedList` attrs so the
 * editor shows the author's numbering instead of restarting every list at 1.
 */
import type { TipTapNode } from '@wren/types';

/** HTML `<ol type>` values TipTap's OrderedList understands (decimal = unset). */
export type OrderedListStyle = 'a' | 'A' | 'i' | 'I';

export type ListMarker =
  | { kind: 'bullet'; marker: string; remaining: string }
  | {
      kind: 'ordered';
      marker: string;
      remaining: string;
      /** Ordinal the marker denotes, e.g. 3 for "3." / "c)" / "iii.". */
      value: number;
      style?: OrderedListStyle;
    };

// Glyph bullets + common OCR stand-ins ("o ", "O ", hollow/square).
export const BULLET_RE =
  /^(?:[•‣◦⁃∙•·▪‣*◦○●■□-]|(?:o|O)(?=\s))\s*/;
// Numbered / lettered / roman — require a following space so "A.Long" stays prose.
export const NUMBERED_RE = /^(\d+[\.)]|[a-zA-Z][\.)]|[ivxlcdmIVXLCDM]+[\.)])\s+/;

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanToInt(roman: string): number | null {
  const s = roman.toLowerCase();
  let total = 0;
  for (let k = 0; k < s.length; k += 1) {
    const cur = ROMAN_VALUES[s[k]!];
    const next = ROMAN_VALUES[s[k + 1] ?? ''] ?? 0;
    if (!cur) return null;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

/** Ordinal + display style for a marker body such as "12", "b", "IV". */
function markerOrdinal(body: string): { value: number; style?: OrderedListStyle } | null {
  if (/^\d+$/.test(body)) return { value: Number(body) };
  // A lone "i"/"I" is far more often roman one than the letter i.
  if (/^[a-zA-Z]$/.test(body) && !/^[iI]$/.test(body)) {
    const lower = body === body.toLowerCase();
    return {
      value: body.toLowerCase().charCodeAt(0) - 96,
      style: lower ? 'a' : 'A',
    };
  }
  const value = romanToInt(body);
  if (value == null) return null;
  return { value, style: body === body.toLowerCase() ? 'i' : 'I' };
}

/** Parse a leading bullet or ordinal marker from already-trimmed text. */
export function parseListMarker(raw: string): ListMarker | null {
  const bullet = BULLET_RE.exec(raw);
  if (bullet) {
    return {
      kind: 'bullet',
      marker: bullet[0],
      remaining: raw.slice(bullet[0].length).trim(),
    };
  }

  const numbered = NUMBERED_RE.exec(raw);
  if (!numbered) return null;
  const prefix = numbered[1] ?? '';
  const ordinal = markerOrdinal(prefix.slice(0, -1));
  if (!ordinal) return null;
  return {
    kind: 'ordered',
    marker: numbered[0],
    remaining: raw.slice(numbered[0].length).trim(),
    value: ordinal.value,
    ...(ordinal.style ? { style: ordinal.style } : {}),
  };
}

/** `orderedList` attrs for a list whose first marker is `first`; undefined when default. */
export function orderedListAttrs(
  first: Extract<ListMarker, { kind: 'ordered' }> | undefined,
): Record<string, unknown> | undefined {
  if (!first) return undefined;
  const attrs: Record<string, unknown> = {};
  if (first.value !== 1) attrs.start = first.value;
  if (first.style) attrs.type = first.style;
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

function intToRoman(value: number): string {
  const table: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let rest = value;
  let out = '';
  for (const [n, glyph] of table) {
    while (rest >= n) {
      out += glyph;
      rest -= n;
    }
  }
  return out;
}

/** Visible marker for item `value` of an `orderedList`, e.g. "3." / "c." / "iii.". */
export function formatOrderedMarker(value: number, style: unknown): string {
  if ((style === 'a' || style === 'A') && value >= 1 && value <= 26) {
    const letter = String.fromCharCode(96 + value);
    return `${style === 'A' ? letter.toUpperCase() : letter}.`;
  }
  if ((style === 'i' || style === 'I') && value >= 1) {
    const roman = intToRoman(value);
    return `${style === 'I' ? roman.toUpperCase() : roman}.`;
  }
  return `${value}.`;
}

/** Ordinal of an `orderedList`'s first item (TipTap default 1). */
export function orderedListStart(node: TipTapNode): number {
  const start = Number(node.attrs?.start);
  return Number.isInteger(start) && start > 0 ? start : 1;
}
