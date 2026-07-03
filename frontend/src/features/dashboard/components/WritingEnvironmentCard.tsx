/**
 * `<WritingEnvironmentCard>` — a "My Documents" dashboard card (frontend
 * steering §4 populated-dashboard screen; task 19.1; Requirement 4.2).
 *
 * Surfaces a Document's Topic (the "Writing Topic" custom-metadata value —
 * product decision 1, read via {@link getDocumentTopic}), its name, and its
 * Status. Status is rendered through the shared `<StatusBadge>` so it stays an
 * enum mapped to color tokens (Requirement 1.2 / steering §9) rather than
 * free-text styling — this component never styles status inline.
 *
 * The card is intentionally minimal: it carries an overflow-menu affordance
 * placeholder (steering §4 lists an "overflow menu" on the populated card) but
 * wires no actions yet — page/route composition (opening the editor, the
 * overflow actions) is convergence work handled elsewhere.
 */
import { MoreHorizontal } from 'lucide-react';

import { getDocumentTopic } from '../documentFilters';

import { StatusBadge } from '@/components/ui';

import type { Document } from '@wren/types';

export interface WritingEnvironmentCardProps {
  readonly document: Document;
  /** Optional open handler; when supplied the title becomes an activating control. */
  readonly onOpen?: (document: Document) => void;
}

export function WritingEnvironmentCard({
  document,
  onOpen,
}: WritingEnvironmentCardProps) {
  const topic = getDocumentTopic(document);

  return (
    <article className="flex flex-col gap-sm rounded-md border border-border-subtle bg-surface-primary px-md py-sm shadow-sm">
      <div className="flex items-start justify-between gap-sm">
        <div className="flex flex-col gap-xs">
          {topic && (
            <span className="text-caption font-sans font-medium uppercase text-text-muted">
              {topic}
            </span>
          )}
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(document)}
              className="self-start text-left text-body font-sans font-semibold text-text-primary hover:underline"
            >
              {document.name}
            </button>
          ) : (
            <h3 className="text-body font-sans font-semibold text-text-primary">
              {document.name}
            </h3>
          )}
        </div>

        {/* Overflow-menu affordance placeholder (steering §4). No actions wired
            yet — convergence work owns the eventual menu. */}
        <button
          type="button"
          aria-label={`Actions for ${document.name}`}
          className="rounded-md p-xs text-text-muted hover:text-text-primary"
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      </div>

      <StatusBadge status={document.status} />
    </article>
  );
}
