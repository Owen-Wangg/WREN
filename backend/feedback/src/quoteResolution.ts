/**
 * Quote-resolution helpers for the AI Debrief rebuild (and Ask WREN).
 * Pure string logic: no AWS SDK, DB, or notification imports, so tests can
 * load this module without the Lambda environment.
 */

/** Snap offsets so quotes never start/end mid-word (matches editor highlight). */
export function expandToWordBoundaries(
  text: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } {
  let start = Math.max(0, Math.min(startOffset, text.length));
  let end = Math.max(start, Math.min(endOffset, text.length));
  while (start > 0 && /\w/.test(text[start - 1] ?? '')) start -= 1;
  while (end < text.length && /\w/.test(text[end] ?? '')) end += 1;
  return { start, end };
}

/**
 * Returns true only for punctuation that genuinely ends a sentence.
 * Periods inside abbreviations are excluded: single uppercase letter (B.C.),
 * period immediately followed by a letter (e.g.), or short capitalized words
 * mid-sentence (Ms., Dr., Prof., Jan., No., etc.).
 */
export function isSentenceEnd(text: string, pos: number): boolean {
  const ch = text[pos];
  if (!ch) return false;
  if (ch === '!' || ch === '?') return true;
  if (ch !== '.') return false;
  // Period followed directly by a letter = abbreviation (B.C, U.S., e.g.)
  const after = text[pos + 1];
  if (after && /[A-Za-z]/.test(after)) return false;
  // Extract the word immediately before this period
  let ws = pos;
  while (ws > 0 && /[A-Za-z]/.test(text[ws - 1]!)) ws--;
  const wordBefore = text.slice(ws, pos);
  // Single uppercase letter: B.C., S. 3(b)
  if (wordBefore.length === 1 && /[A-Z]/.test(wordBefore)) return false;
  // Short capitalized word: likely abbreviation/title
  // (Ms., Dr., Jr., Prof., Rev., Jan., No., Vol., etc.)
  if (
    wordBefore.length > 1 &&
    wordBefore.length <= 5 &&
    /[A-Z]/.test(wordBefore[0]!)
  ) {
    return false;
  }
  // Period followed by whitespace or end: sentence end only when the next
  // non-whitespace character is uppercase (new sentence) or there is none.
  let j = pos + 1;
  while (j < text.length && /\s/.test(text[j]!)) j++;
  if (j >= text.length || /[A-Z”'([`”']/.test(text[j]!)) return true;
  // Digit after period: sentence end only if the preceding word is long
  // (not an abbreviation like “s. 3” or “para. 10”) — handles inline
  // footnote numbers in legal text.
  if (/[0-9]/.test(text[j]!) && wordBefore.length > 5) return true;
  return false;
}

/**
 * Expand a located span to the nearest complete sentence so the displayed
 * quote is never a dangling clause. Walks backward to a sentence-starting
 * boundary and forward to a sentence-ending punctuation mark. Capped so we
 * never pull in more than one sentence beyond the original span.
 */
export function expandToSentenceBoundaries(
  text: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } {
  const MAX_LOOKBACK = 200;
  const MAX_LOOKAHEAD = 200;

  let start = Math.max(0, startOffset);
  let end = Math.min(text.length, endOffset);

  // Walk backward to the character after the previous sentence-end (or the
  // beginning of the paragraph), skipping leading whitespace.
  const lookbackFrom = Math.max(0, start - MAX_LOOKBACK);
  let s = start;
  while (s > lookbackFrom) {
    if (isSentenceEnd(text, s - 1)) break;
    s -= 1;
  }
  // Skip whitespace after the sentence boundary.
  while (s < start && /\s/.test(text[s] ?? '')) s += 1;
  start = s;

  // Walk forward to the next sentence-end punctuation, then include it.
  const lookaheadTo = Math.min(text.length, end + MAX_LOOKAHEAD);
  let e = end;
  while (e < lookaheadTo) {
    e += 1;
    if (isSentenceEnd(text, e - 1)) break;
  }
  end = e;

  return { start, end };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Map typographic single/double quotes to their straight forms.
 * Each member is one UTF-16 code unit, so length and offsets are preserved.
 * Keep in sync with _TYPOGRAPHIC_QUOTE_FOLD in backend/engine/python/handler.py.
 */
export function foldTypographicQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
}

const identityFold = (s: string): string => s;

/**
 * Locate a (possibly truncated) model quote inside a paragraph and expand to
 * whole words so the debrief quote matches the document highlight.
 *
 * With `typographic: true`, both strings are compared after
 * foldTypographicQuotes (curly ’ “ ” ≡ straight ' "); the returned text is
 * always sliced from the ORIGINAL paragraphText. With the default `false`,
 * fold is the identity and behaviour is unchanged.
 */
export function resolveExactQuoteInParagraph(
  paragraphText: string,
  quotedText: string,
  { typographic = false }: { typographic?: boolean } = {},
): string | null {
  const fold = typographic ? foldTypographicQuotes : identityFold;
  // Typographic pass only helps when the fold actually changes something.
  if (
    typographic &&
    fold(paragraphText) === paragraphText &&
    fold(quotedText) === quotedText
  ) {
    return null;
  }
  // searchText has the same length/offsets as paragraphText (1:1 fold).
  const searchText = fold(paragraphText);

  const fullNormalized = fold(quotedText).trim().replace(/\s+/g, ' ');
  if (!fullNormalized || !paragraphText) return null;

  const candidates = [fullNormalized];
  const words = fullNormalized.split(' ');
  if (words.length > 2) {
    const last = words[words.length - 1] ?? '';
    const looksTruncated = last.length > 0 && last.length < 6 && !/[.!?,"')\]]$/.test(last);
    if (looksTruncated) {
      candidates.push(words.slice(0, -1).join(' '));
    }
  }

  for (const candidate of candidates) {
    let idx = searchText.indexOf(candidate);
    if (idx < 0) {
      idx = searchText.toLowerCase().indexOf(candidate.toLowerCase());
    }
    if (idx < 0) continue;

    let end = idx + candidate.length;
    // Verification guard (typographic path only, mirrors the engine's step-4
    // guard): toLowerCase() can change length for some code points (e.g. 'İ'),
    // which would misalign idx against the original text. Accept only when the
    // folded slice is equivalent to the candidate.
    if (
      typographic &&
      searchText.slice(idx, end).replace(/\s+/g, ' ').toLowerCase() !==
        candidate.replace(/\s+/g, ' ').toLowerCase()
    ) {
      continue;
    }
    if (candidate !== fullNormalized) {
      const stem = fullNormalized.split(' ').pop() ?? '';
      if (stem) {
        const rest = searchText.slice(end);
        const expansion = rest.match(new RegExp(`^${escapeRegExp(stem)}\\w*`, 'i'));
        if (expansion) end += expansion[0].length;
      }
    }

    const expanded = expandToWordBoundaries(paragraphText, idx, end);
    return paragraphText.slice(expanded.start, expanded.end);
  }
  return null;
}

export function segmentTextAt(
  segments: Array<{ index?: number; text?: string }>,
  paragraphIndex: number,
): string {
  const byIndex = segments.find((s) => s.index === paragraphIndex);
  if (byIndex && typeof byIndex.text === 'string') return byIndex.text;
  const byPos = segments[paragraphIndex];
  return typeof byPos?.text === 'string' ? byPos.text : '';
}

/**
 * Rebuild quotedText from the draft paragraph so the AI Debrief shows the
 * same exact span the editor highlights (word-complete, not mid-token cutoff).
 */
export interface ResolvedQuote {
  text: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
}

export function resolveQuotedTextForItem(
  row: any,
  anchorByFeedbackId: Map<string, any>,
  segments: Array<{ index?: number; text?: string }>,
): ResolvedQuote | undefined {
  const stored = typeof row.quoted_text === 'string' ? row.quoted_text : undefined;
  const anchor =
    (row.current_anchor_id
      ? [...anchorByFeedbackId.values()].find((a) => a.id === row.current_anchor_id)
      : undefined) ?? anchorByFeedbackId.get(row.id);

  // Helper: expand a located quote to a full sentence and return resolved offsets.
  const expandQuote = (para: string, fromQuote: string, paraIndex: number): ResolvedQuote => {
    const idx = para.indexOf(fromQuote);
    if (idx >= 0) {
      const sentence = expandToSentenceBoundaries(para, idx, idx + fromQuote.length);
      const text = para.slice(sentence.start, sentence.end).trim() || fromQuote;
      const finalStart = para.indexOf(text, Math.max(0, sentence.start - 1));
      return {
        text,
        paragraphIndex: paraIndex,
        startOffset: finalStart >= 0 ? finalStart : sentence.start,
        endOffset: finalStart >= 0 ? finalStart + text.length : sentence.end,
      };
    }
    const fallbackIdx = para.indexOf(fromQuote);
    return {
      text: fromQuote,
      paragraphIndex: paraIndex,
      startOffset: fallbackIdx >= 0 ? fallbackIdx : 0,
      endOffset: fallbackIdx >= 0 ? fallbackIdx + fromQuote.length : fromQuote.length,
    };
  };

  // When a stored quote text is available, always prefer finding it verbatim
  // over using raw anchor offsets — offsets can point to the wrong paragraph
  // when the document structure shifts between drafts.
  if (stored) {
    // Two passes over steps 1–2: the first (typographic=false) is the
    // original literal matcher, so anything that resolves today resolves
    // identically. Only when it fails everywhere do we retry with curly/
    // straight quotes folded (’ ≡ ', “ ” ≡ "). The returned text is always a
    // slice of the original paragraph, so expandQuote's indexOf still finds it.
    for (const typographic of [false, true]) {
      // 1. Try the anchor's own paragraph first (fast path).
      if (anchor) {
        const paraIndex = Number(anchor.paragraph_index ?? 0);
        const para = segmentTextAt(segments, paraIndex);
        if (para) {
          const fromQuote = resolveExactQuoteInParagraph(para, stored, { typographic });
          if (fromQuote) return expandQuote(para, fromQuote, paraIndex);
        }
      }

      // 2. Scan all segments (handles misaligned paragraph index).
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const paraIndex = segment.index ?? i;
        const para = typeof segment.text === 'string' ? segment.text : '';
        const fromQuote = resolveExactQuoteInParagraph(para, stored, { typographic });
        if (fromQuote) return expandQuote(para, fromQuote, paraIndex);
      }
    }

    // 3. Anchor offsets as last resort — only reached when the stored quote
    //    text cannot be found anywhere in the current draft (e.g. paragraph
    //    was deleted). Raw offsets in the anchor's paragraph are better than
    //    returning nothing.
    if (anchor) {
      const paraIndex = Number(anchor.paragraph_index ?? 0);
      const para = segmentTextAt(segments, paraIndex);
      if (para) {
        const start = Number(anchor.start_offset ?? 0);
        const end = Number(anchor.end_offset ?? 0);
        if (end > start && end <= para.length) {
          const sentence = expandToSentenceBoundaries(para, start, end);
          const slice = para.slice(sentence.start, sentence.end).trim();
          if (slice) {
            const sliceStart = para.indexOf(slice, Math.max(0, sentence.start - 1));
            return {
              text: slice,
              paragraphIndex: paraIndex,
              startOffset: sliceStart >= 0 ? sliceStart : sentence.start,
              endOffset: sliceStart >= 0 ? sliceStart + slice.length : sentence.end,
            };
          }
          const raw = para.slice(start, end).trim();
          if (raw) return { text: raw, paragraphIndex: paraIndex, startOffset: start, endOffset: end };
        }
      }
    }

    return { text: stored, paragraphIndex: Number(anchor?.paragraph_index ?? 0), startOffset: 0, endOffset: 0 };
  }

  // No stored quote — fall back to anchor offsets directly.
  if (anchor) {
    const paraIndex = Number(anchor.paragraph_index ?? 0);
    const para = segmentTextAt(segments, paraIndex);
    if (para) {
      const start = Number(anchor.start_offset ?? 0);
      const end = Number(anchor.end_offset ?? 0);
      if (end > start && end <= para.length) {
        const sentence = expandToSentenceBoundaries(para, start, end);
        const slice = para.slice(sentence.start, sentence.end).trim();
        if (slice) {
          const sliceStart = para.indexOf(slice, Math.max(0, sentence.start - 1));
          return {
            text: slice,
            paragraphIndex: paraIndex,
            startOffset: sliceStart >= 0 ? sliceStart : sentence.start,
            endOffset: sliceStart >= 0 ? sliceStart + slice.length : sentence.end,
          };
        }
        const raw = para.slice(start, end).trim();
        if (raw) return { text: raw, paragraphIndex: paraIndex, startOffset: start, endOffset: end };
      }
    }
  }

  return undefined;
}
