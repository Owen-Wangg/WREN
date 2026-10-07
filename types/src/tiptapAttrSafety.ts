/**
 * Allowlist validation for TipTap attribute values that reach HTML/CSS sinks.
 *
 * The frontend PDF / page-estimate renderer interpolates a handful of node and
 * mark attributes into `style="…"` and `src="…"`. Node-type allowlisting alone
 * (see `findDisallowedTipTapNodeType`) does not constrain those values, so a
 * persisted `{"src":"x\" onerror=…"}` would break out of the attribute.
 *
 * - Document Lambda: `findUnsafeTipTapAttr` → reject the write (400).
 * - Frontend: `stripUnsafeTipTapAttrs` on load / before save so legacy or
 *   pasted content never trips the server check; the renderer re-validates
 *   with the same predicates before emitting HTML.
 *
 * Validators are anchored, length-capped, and use non-overlapping character
 * classes so they run in linear time on attacker-sized input.
 */

import type { TipTapNode } from './tiptapContent';

const MAX_COLOR_LENGTH = 100;
const MAX_FONT_FAMILY_LENGTH = 200;
const MAX_FONT_SIZE_LENGTH = 32;
const MAX_RELATIVE_SRC_LENGTH = 1024;

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
/** rgb()/hsl()/oklch()… — no nested parens, quotes, `;`, or `:` inside. */
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\w.%\s,/+-]*\)$/i;
const CSS_VAR_COLOR = /^var\(--[\w-]+\)$/;
/** Named colors plus `transparent` / `currentColor`. */
const NAMED_COLOR = /^[a-z]{3,30}$/i;

/** Unicode font names, comma-separated stacks, quoted multi-word names. */
const FONT_FAMILY = /^[\p{L}\p{N}\s,'"_.+-]+$/u;

const FONT_SIZE_LENGTH = /^\d{1,4}(?:\.\d{1,4})?(?:pt|px|em|rem|%|ex|ch)?$/i;
/** `small`, `x-large`, `larger`, … */
const FONT_SIZE_KEYWORD = /^[a-z-]{3,20}$/i;

const TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

const DATA_IMAGE_SRC = /^data:image\/[a-z0-9.+-]{1,40};base64,[A-Za-z0-9+/]+={0,2}$/i;
/**
 * Absolute http(s) URL without whitespace, `"`, `<`, `>`, backtick, or `\`.
 * (`'` is legal in URLs; renderers always emit double-quoted, escaped attrs.)
 */
const HTTP_SRC = /^https?:\/\/[^\s"<>`\\]+$/i;
/** Scheme-less storage key, e.g. `figures/{documentId}/figure-1-0.png` (Textract figures). */
const RELATIVE_SRC = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

/** True for hex, functional, `var(--x)`, or named CSS colors. */
export function isSafeCssColor(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_COLOR_LENGTH) return false;
  return (
    HEX_COLOR.test(v) ||
    FUNCTIONAL_COLOR.test(v) ||
    CSS_VAR_COLOR.test(v) ||
    NAMED_COLOR.test(v)
  );
}

function hasBalancedQuotes(value: string): boolean {
  const doubles = value.split('"').length - 1;
  const singles = value.split("'").length - 1;
  return doubles % 2 === 0 && singles % 2 === 0;
}

/**
 * True for a CSS font-family stack without declaration/function syntax
 * (`;`, `:`, `(`, `)`, `{`, `}`, `<`, `>`, `\`). Quotes must be balanced so an
 * unterminated CSS string cannot swallow later declarations.
 */
export function isSafeCssFontFamily(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_FONT_FAMILY_LENGTH) return false;
  return FONT_FAMILY.test(v) && hasBalancedQuotes(v);
}

/** True for `12pt`, `16px`, `1.2em`, `120%`, bare numbers, or size keywords. */
export function isSafeCssFontSize(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_FONT_SIZE_LENGTH) return false;
  return FONT_SIZE_LENGTH.test(v) || FONT_SIZE_KEYWORD.test(v);
}

/** True for a CSS `text-align` keyword the editor can produce. */
export function isSafeTextAlign(value: string): boolean {
  return TEXT_ALIGN_VALUES.has(value);
}

/**
 * True for image sources the editor and ingest pipeline produce:
 * base64 `data:image/*`, absolute http(s) URLs, or scheme-less storage keys.
 * Rejects `javascript:` and every other scheme.
 */
export function isSafeImageSrc(value: string): boolean {
  if (value.length === 0) return false;
  if (DATA_IMAGE_SRC.test(value)) return true;
  if (HTTP_SRC.test(value)) return true;
  return value.length <= MAX_RELATIVE_SRC_LENGTH && RELATIVE_SRC.test(value);
}

/**
 * Attribute keys that reach an HTML/CSS sink, mapped to their validator.
 * Checked wherever the key appears (node attrs or mark attrs). `Map` avoids
 * prototype keys such as `constructor` resolving to a validator.
 */
const ATTR_VALIDATORS: ReadonlyMap<string, (value: string) => boolean> = new Map([
  ['src', isSafeImageSrc],
  ['color', isSafeCssColor],
  ['backgroundColor', isSafeCssColor],
  ['fontFamily', isSafeCssFontFamily],
  ['fontSize', isSafeCssFontSize],
  ['textAlign', isSafeTextAlign],
]);

/**
 * True when `value` is not acceptable for `key`. Null/undefined/empty string
 * mean "unset" and are always acceptable; any other non-string is rejected.
 */
function isUnsafeAttrValue(key: string, value: unknown): boolean {
  const validate = ATTR_VALIDATORS.get(key);
  if (!validate) return false;
  if (value === null || value === undefined || value === '') return false;
  if (typeof value !== 'string') return true;
  return !validate(value);
}

/** Client-supplied type name, reduced to a short identifier for error messages. */
function label(type: unknown, fallback: string): string {
  if (typeof type !== 'string') return fallback;
  return type.replace(/[^\w-]/g, '').slice(0, 40) || fallback;
}

function firstUnsafeAttrKey(attrs: Record<string, unknown> | undefined): string | null {
  if (!attrs || typeof attrs !== 'object') return null;
  for (const [key, value] of Object.entries(attrs)) {
    if (isUnsafeAttrValue(key, value)) return key;
  }
  return null;
}

/**
 * Return a short description of the first attribute whose value is not
 * allowlisted (e.g. `image.src`, `textStyle mark.fontFamily`), or null.
 * Walks `content` and footnote `attrs.content` the same way as
 * `findDisallowedTipTapNodeType`.
 */
export function findUnsafeTipTapAttr(node: TipTapNode): string | null {
  if (!node || typeof node !== 'object') return null;
  const badNodeAttr = firstUnsafeAttrKey(node.attrs);
  if (badNodeAttr) return `${label(node.type, 'node')}.${badNodeAttr}`;

  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      const badMarkAttr = firstUnsafeAttrKey(mark?.attrs);
      if (badMarkAttr) return `${label(mark?.type, 'unknown')} mark.${badMarkAttr}`;
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = findUnsafeTipTapAttr(child);
      if (found) return found;
    }
  }
  const attrContent = node.attrs?.content;
  if (attrContent && typeof attrContent === 'object' && !Array.isArray(attrContent)) {
    const found = findUnsafeTipTapAttr(attrContent as TipTapNode);
    if (found) return found;
  }
  return null;
}

/** Copy of `attrs` without unsafe values, or the same object when all are safe. */
function stripUnsafeAttrs(
  attrs: Record<string, unknown>,
  replacement: 'null' | 'delete',
): Record<string, unknown> {
  let next: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(attrs)) {
    if (!isUnsafeAttrValue(key, value)) continue;
    next ??= { ...attrs };
    if (replacement === 'null') next[key] = null;
    else delete next[key];
  }
  return next ?? attrs;
}

function isUnsafeImage(node: TipTapNode): boolean {
  return !!node && node.type === 'image' && isUnsafeAttrValue('src', node.attrs?.src);
}

/**
 * Remove attribute values that `findUnsafeTipTapAttr` would reject.
 *
 * - Image nodes with an unsafe `src` are dropped (they cannot render).
 * - Other unsafe node attrs are set to `null` (TipTap's "unset" default).
 * - Unsafe mark attrs are deleted.
 *
 * Returns the same reference for subtrees that need no change.
 */
export function stripUnsafeTipTapAttrs<T extends TipTapNode>(node: T): T {
  if (!node || typeof node !== 'object') return node;
  let next: T = node;
  const edit = (): T => {
    if (next === node) next = { ...node };
    return next;
  };

  if (node.attrs && typeof node.attrs === 'object') {
    let attrs = stripUnsafeAttrs(node.attrs, 'null');
    const attrContent = attrs.content;
    if (attrContent && typeof attrContent === 'object' && !Array.isArray(attrContent)) {
      const cleaned = stripUnsafeTipTapAttrs(attrContent as TipTapNode);
      if (cleaned !== attrContent) attrs = { ...attrs, content: cleaned };
    }
    if (attrs !== node.attrs) edit().attrs = attrs;
  }

  if (Array.isArray(node.marks)) {
    let changed = false;
    const marks = node.marks.map((mark) => {
      if (!mark?.attrs || typeof mark.attrs !== 'object') return mark;
      const attrs = stripUnsafeAttrs(mark.attrs, 'delete');
      if (attrs === mark.attrs) return mark;
      changed = true;
      return { ...mark, attrs };
    });
    if (changed) edit().marks = marks;
  }

  if (Array.isArray(node.content)) {
    let changed = false;
    const content: TipTapNode[] = [];
    for (const child of node.content) {
      if (isUnsafeImage(child)) {
        changed = true;
        continue;
      }
      const cleaned = stripUnsafeTipTapAttrs(child);
      if (cleaned !== child) changed = true;
      content.push(cleaned);
    }
    if (changed) edit().content = content;
  }

  return next;
}
