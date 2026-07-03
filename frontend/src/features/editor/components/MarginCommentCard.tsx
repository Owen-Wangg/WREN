/**
 * `<MarginCommentCard>` — a single margin/comment card for one anchored (or
 * "no longer applies") inline Feedback Item (task 18.2; Requirements 11.2,
 * 12.1, 12.2, 12.3, 12.4).
 *
 * **No-ghostwriting compliance (load-bearing, not cosmetic — frontend
 * steering §3):** this card renders only the error category label and the
 * Socratic `questionText` (Requirement 12.3 — never an internal "correct
 * version"), and contains NO Apply/Insert/Accept/Use-this affordance
 * anywhere. Every instance carries `data-ai-feedback="true"` plus
 * token-derived `notice`/`signal` background and border classes (never a raw
 * hex/px — steering §9), so this card is structurally and visually
 * distinguishable from writer-authored text wherever both appear together in
 * the editor view.
 *
 * `role="button"` + `tabIndex=0` + `Enter`/`Space` handling implements the
 * select-item → highlight-span half of the linkage (Requirement 12.2)
 * accessibly, without introducing an unstyled native `<button>` inside a
 * `role="listitem"` (semantic HTML first, ARIA only where needed — steering
 * §8). `aria-current` marks the card whose span is currently
 * selected/highlighted in the editor (the highlight-span → select-item half of
 * the linkage, driven by the editor's `onCommentActivated` callback).
 */
import { Ban } from 'lucide-react';

import type { AnchoredFeedbackItem } from '../feedbackAnchoring';

export interface MarginCommentCardProps {
  readonly item: AnchoredFeedbackItem;
  readonly categoryLabel: string;
  /** True when this item's span is the one currently highlighted in the editor. */
  readonly isSelected: boolean;
  /** True for anchors that are `removed` / have no `currentAnchorId` (Requirement 12.4). */
  readonly isRemoved: boolean;
  readonly onSelect: (feedbackItemId: string) => void;
  readonly className?: string;
}

export function MarginCommentCard({
  item,
  categoryLabel,
  isSelected,
  isRemoved,
  onSelect,
  className,
}: MarginCommentCardProps) {
  const handleActivate = () => {
    if (!isRemoved) {
      onSelect(item.feedbackItem.id);
    }
  };

  return (
    <li
      // Structural no-ghostwriting marker — never present on writer-authored
      // text (steering §3; compliance assertion in task 18.7's render tests).
      data-ai-feedback="true"
      data-feedback-item-id={item.feedbackItem.id}
      data-removed={isRemoved ? 'true' : undefined}
      role="button"
      tabIndex={isRemoved ? -1 : 0}
      aria-current={isSelected ? 'true' : undefined}
      aria-disabled={isRemoved ? 'true' : undefined}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleActivate();
        }
      }}
      className={[
        'flex flex-col gap-xs rounded-md border px-md py-sm text-bodySmall',
        isRemoved
          ? 'cursor-default border-border-subtle bg-surface-subtle text-text-muted'
          : 'cursor-pointer bg-notice-surface text-text-secondary',
        !isRemoved && isSelected
          ? 'border-text-primary'
          : !isRemoved
            ? 'border-notice-border'
            : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center justify-between gap-sm">
        <span className="text-caption font-sans font-medium uppercase text-text-muted">
          {categoryLabel}
        </span>
        {isRemoved && (
          <span className="inline-flex items-center gap-xs text-caption text-text-muted">
            <Ban size={12} aria-hidden="true" />
            No longer applies
          </span>
        )}
      </div>
      {/* Socratic question only — never an internal "correct version"
          (Requirement 12.3). */}
      <p className="text-body text-text-primary">{item.feedbackItem.questionText}</p>
    </li>
  );
}
