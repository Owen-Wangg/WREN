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
    <article className="relative flex h-[200px] w-[380px] flex-col justify-between rounded-md border border-text-muted/25 bg-surface-primary p-lg shadow-md">
      <div className="flex flex-col gap-xs">
        <span className="text-bodySmall font-sans text-text-primary/45">
          Environment: {document.writingTypeId}
        </span>
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(document)}
            className="self-start text-left text-heading2 font-sans font-semibold text-text-primary hover:underline"
          >
            {document.name}
          </button>
        ) : (
          <h3 className="text-heading2 font-sans font-semibold text-text-primary">
            {document.name}
          </h3>
        )}
        <StatusBadge status={document.status} />
      </div>

      <div className="flex flex-col gap-xs">
        {topic && (
          <p className="text-bodySmall text-text-primary">
            <span className="font-bold">Topic:</span> {topic}
          </p>
        )}
        <p className="text-bodySmall text-text-primary">
          <span className="font-bold">Date Added:</span>{' '}
          {new Date(document.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Overflow-menu affordance placeholder (steering §4). No actions wired
          yet — convergence work owns the eventual menu. */}
      <button
        type="button"
        aria-label={`Actions for ${document.name}`}
        className="absolute bottom-lg right-lg rounded-md p-xs text-text-muted hover:text-text-primary"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
    </article>
  );
}
