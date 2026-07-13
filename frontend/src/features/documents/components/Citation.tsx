/**
 * `<Citation>` — citation display for a `FeedbackItem` (frontend steering §4;
 * task 18.6; Requirements 21.1–21.4).
 *
 * Renders the Reference Material's source identity (title/section) when a
 * `FeedbackItem.citationReferenceId` resolves to citation data. Citation
 * resolution against the backend (task 10.3) isn't built yet, so this
 * component accepts already-resolved citation data as a prop rather than
 * resolving `citationReferenceId` itself; when no citation informed the item,
 * `citation` is `undefined` and nothing renders (Requirement 21.4). Never
 * reproduces replacement prose (Requirement 21.3) — only title/section text.
 */
export interface ResolvedCitation {
  readonly title: string;
  readonly section?: string;
}

export interface CitationProps {
  readonly citation: ResolvedCitation | undefined;
  readonly className?: string;
}

export function Citation({ citation, className }: CitationProps) {
  if (!citation) {
    return null;
  }

  return (
    <p
      className={[
        'text-caption text-text-muted',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      Source: {citation.title}
      {citation.section ? `, ${citation.section}` : ''}
    </p>
  );
}
