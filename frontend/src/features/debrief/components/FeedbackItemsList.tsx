/**
 * `<FeedbackItemsList>` — renders a list of `FeedbackItem`s (task 18.3).
 *
 * Self-contained to `features/debrief/` (not shared with the editor's inline
 * anchored-comment rendering in `features/editor/`, which is task 18.2's
 * separate concern — same span of work, different rendering surface, kept
 * apart to avoid file collisions between the two parallel B2 tasks).
 *
 * Renders only `{questionText, errorCategoryId, citationReferenceId?}` — there
 * is no field in `FeedbackItem` (`@wren/types`) for replacement prose, and this
 * component never renders any button that would apply/insert/accept AI text
 * into the writer's draft (REQ-CORE-NOGHOST-01 / frontend steering §3, §11).
 */
import type { FeedbackItem } from '@wren/types';

export interface FeedbackItemsListProps {
  readonly items: readonly FeedbackItem[];
  readonly emptyMessage: string;
  readonly className?: string;
}

export function FeedbackItemsList({
  items,
  emptyMessage,
  className,
}: FeedbackItemsListProps) {
  if (items.length === 0) {
    return (
      <p className={['text-bodySmall text-text-muted', className].filter(Boolean).join(' ')}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className={['flex flex-col gap-sm', className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-md border border-border-subtle bg-surface-primary px-md py-sm"
        >
          <span className="mb-xs block text-caption font-sans font-medium uppercase text-text-muted">
            {item.errorCategoryId}
          </span>
          {/* Socratic question / error-type flag only — never replacement prose. */}
          <p className="text-body text-text-primary">{item.questionText}</p>
          {item.citationReferenceId && (
            <p className="mt-xs text-caption text-text-muted">
              Source: {item.citationReferenceId}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
