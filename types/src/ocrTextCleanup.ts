/**
 * Repair OCR spacing and scattered bold/italic in persisted TipTap inline content.
 *
 * Mirrors ingest-time helpers in `textractFormatting.ts` so load-time sanitization
 * can fix already-uploaded drafts without re-ingest.
 */
import type { TipTapNode } from './tiptapContent';

const SCATTER_GROUP_LIMIT = 1;

const NO_SPACE_BEFORE = /^[.,;:!?%)\]}’”/-]/;
const NO_SPACE_AFTER = /[(\[{‘“-]$/;
const CONTRACTION_NEXT = /^'(?:s|t|re|ve|ll|d|m)$/i;

function isStraightQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "'";
}

/** True when two adjacent token strings should be separated by a space. */
export function needsSpaceBetween(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  if (/\s$/.test(prev) || /^\s/.test(next)) return false;

  const prevTrim = prev.trimEnd();
  const nextTrim = next.trimStart();
  const prevEnd = prevTrim[prevTrim.length - 1];
  const nextStart = nextTrim[0];

  if (CONTRACTION_NEXT.test(nextTrim) && /[A-Za-z]$/.test(prevTrim)) {
    return false;
  }

  if (isStraightQuote(nextStart) && /[A-Za-z0-9]$/.test(prevTrim)) {
    return nextTrim.length > 1;
  }
  if (isStraightQuote(prevEnd) && /^[A-Za-z0-9]/.test(nextTrim)) {
    return prevTrim.length > 1;
  }

  if (NO_SPACE_BEFORE.test(nextTrim)) return false;
  if (NO_SPACE_AFTER.test(prevTrim)) return false;
  return true;
}

/** Surname prefixes that are legitimately followed by a capital (`MacEwan`, `VanDyke`). */
const NAME_PREFIX_RE = /^(?:Mac|Mc|Van|Von|Vander|De|Del|Della|Di|Da|Du|Le|La|St|Fitz|O)$/;

function splitGlued(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match: string, head: string, tail: string, offset: number) => {
    // Letters of the same word that precede `head` (e.g. the "M" of "MacEwan").
    const lead = /[A-Za-z]*$/.exec(text.slice(0, offset))?.[0] ?? '';
    return NAME_PREFIX_RE.test(lead + head) ? match : `${head} ${tail}`;
  });
}

/**
 * Split glued OCR tokens (`TheNegligence`, `wordWord`) inside a text span.
 * Surname prefixes (`MacEwan`, `McDonald`, `VanDyke`) are left intact.
 */
export function fixGluedWordsInText(text: string): string {
  let out = splitGlued(text, /([a-z]{2,})([A-Z][a-z]{2,})/g);
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = splitGlued(out, /([A-Z][a-z]{2,})([A-Z][a-z]{2,})/g);
  }
  return out;
}

function countMarkGroups(content: TipTapNode[], markType: string): number {
  let groups = 0;
  let inGroup = false;
  for (const node of content) {
    if (node.type !== 'text') continue;
    const has = node.marks?.some((m) => m.type === markType) ?? false;
    if (has && !inGroup) groups += 1;
    inGroup = has;
  }
  return groups;
}

function stripMarkFromContent(content: TipTapNode[], markType: string): TipTapNode[] {
  return content.map((node) => {
    if (node.type !== 'text' || !node.marks?.length) return node;
    const marks = node.marks.filter((m) => m.type !== markType);
    if (marks.length === node.marks.length) return node;
    return marks.length > 0 ? { ...node, marks } : { type: 'text', text: node.text };
  });
}

function spaceSeparateInlineNodes(content: TipTapNode[]): TipTapNode[] {
  if (content.length <= 1) return content;

  const out: TipTapNode[] = [];
  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;
    const next = content[i + 1];

    if (
      node.type === 'text' &&
      typeof node.text === 'string' &&
      next?.type === 'text' &&
      typeof next.text === 'string' &&
      needsSpaceBetween(node.text, next.text)
    ) {
      out.push({ ...node, text: `${node.text.replace(/\s+$/, '')} ` });
      continue;
    }

    out.push(node);
  }
  return out;
}

/**
 * Normalize inline paragraph content: glued words, missing spaces, scattered marks.
 */
export function normalizeParagraphInlineContent(content: TipTapNode[]): TipTapNode[] {
  if (content.length === 0) return content;

  let nodes: TipTapNode[] = content.map((node) => {
    if (node.type !== 'text' || typeof node.text !== 'string') return node;
    const fixed = fixGluedWordsInText(node.text);
    return fixed === node.text ? node : { ...node, text: fixed };
  });

  nodes = spaceSeparateInlineNodes(nodes);

  for (const markType of ['bold', 'italic'] as const) {
    if (countMarkGroups(nodes, markType) > SCATTER_GROUP_LIMIT) {
      nodes = stripMarkFromContent(nodes, markType);
    }
  }

  return nodes;
}

/** Walk a TipTap tree and clean OCR artifacts in paragraph inline content. */
export function cleanOcrInlineContent(node: TipTapNode): TipTapNode {
  if (node.type === 'paragraph' && node.content?.length) {
    const normalized = normalizeParagraphInlineContent(node.content);
    const changed = normalized.some((child, i) => child !== node.content![i]);
    if (changed) {
      return { ...node, content: normalized };
    }
    return node;
  }

  if (!node.content?.length) return node;

  let changed = false;
  const content = node.content.map((child) => {
    const next = cleanOcrInlineContent(child);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, content } : node;
}
