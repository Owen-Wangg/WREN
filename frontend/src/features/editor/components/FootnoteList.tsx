/**
 * `<FootnoteList>` — renders every footnote in the document at the bottom of
 * the editor's scroll container, sorted by `footnoteNumber` ascending
 * regardless of input order (footnote-citation-support spec, Requirement 3.6).
 *
 * Pure presentational component — mirrors the existing toolbar primitives'
 * design-token-only styling convention (frontend steering §9): no hardcoded
 * colors/sizes, only Tailwind utility classes backed by `theme.css` tokens.
 */
import type { FootnoteAttrs } from '../tiptapFootnote';

export interface FootnoteListProps {
  readonly footnotes: readonly FootnoteAttrs[];
}

/** Plain-text flatten of a footnote's rich-text body for list display. */
function flattenBodyText(content: FootnoteAttrs['content']): string {
  const node = content as { text?: string; content?: unknown[] } | null | undefined;
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content
    .map((child) => flattenBodyText(child as FootnoteAttrs['content']))
    .join(' ')
    .trim();
}

/** Non-empty citation fields, in a stable display order. */
function citationSummary(footnote: FootnoteAttrs): string {
  const parts = [
    footnote.author,
    footnote.title,
    footnote.source,
    footnote.pinpoint,
    footnote.year,
  ].filter((value) => value.trim().length > 0);
  return parts.join(', ');
}

export function FootnoteList({ footnotes }: FootnoteListProps) {
  if (footnotes.length === 0) return null;

  const sorted = [...footnotes].sort((a, b) => a.footnoteNumber - b.footnoteNumber);

  return (
    <div
      data-footnote-list
      role="list"
      aria-label="Footnotes"
      className="mt-2xl border-t border-border-subtle pt-lg text-bodySmall text-text-secondary"
    >
      <ol className="flex flex-col gap-sm">
        {sorted.map((footnote) => {
          const bodyText = flattenBodyText(footnote.content);
          const citation = citationSummary(footnote);
          return (
            <li
              key={footnote.footnoteNumber}
              role="listitem"
              data-footnote-number={footnote.footnoteNumber}
              className="flex gap-xs"
            >
              <span aria-hidden="true" className="text-caption text-text-muted">
                {footnote.footnoteNumber}.
              </span>
              <span className="flex-1">
                {bodyText}
                {bodyText && citation ? ' — ' : ''}
                {citation}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
