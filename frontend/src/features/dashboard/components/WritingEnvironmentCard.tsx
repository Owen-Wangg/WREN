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
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { getDocumentTopic } from '../documentFilters';

import { StatusBadge } from '@/components/ui';

import type { Document } from '@wren/types';

export interface WritingEnvironmentCardProps {
  readonly document: Document;
  /** Resolved document type name for display on the card. */
  readonly documentTypeName?: string;
  /** Optional open handler; when supplied the title becomes an activating control. */
  readonly onOpen?: (document: Document) => void;
  /** Optional delete handler; when supplied a trash icon is shown. */
  readonly onDelete?: (document: Document) => void;
}

export function WritingEnvironmentCard({
  document,
  documentTypeName,
  onOpen,
  onDelete,
}: WritingEnvironmentCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const topic = getDocumentTopic(document);
  const organization = document.metadata['Organization'];
  const documentType = document.metadata['Document Type'];

  const breadcrumb = [organization, documentType]
    .filter(Boolean)
    .join(' > ');

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
    dialogRef.current?.showModal();
  };

  const handleConfirmDelete = () => {
    dialogRef.current?.close();
    setShowDeleteDialog(false);
    onDelete?.(document);
  };

  const handleCancelDelete = () => {
    dialogRef.current?.close();
    setShowDeleteDialog(false);
  };

  return (
    <>
      <article className="relative flex h-[200px] w-[380px] flex-col justify-between rounded-md border border-text-muted/25 bg-surface-primary p-lg transition-all duration-200 hover:border-accent-primary/60 hover:shadow-lg hover:shadow-accent-primary/20 cursor-pointer">
        <div className="flex flex-col gap-xs">
          {breadcrumb && (
            <span className="text-bodySmall font-sans text-text-primary/45">
              {breadcrumb}
            </span>
          )}
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
              <span className="font-bold">Content:</span> {topic}
            </p>
          )}
          {documentTypeName && (
            <p className="text-bodySmall text-text-primary">
              <span className="font-bold">Document Type:</span> {documentTypeName}
            </p>
          )}
          <p className="text-bodySmall text-text-primary">
            <span className="font-bold">Date Added:</span>{' '}
            {new Date(document.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="absolute bottom-lg right-lg">
          <button
            type="button"
            aria-label={`Delete ${document.name}`}
            className="rounded-md p-xs text-text-muted hover:text-signal-critical"
            onClick={handleDeleteClick}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </article>

      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto h-fit w-full max-w-md rounded-xl border border-border-strong/50 bg-surface-primary p-2xl shadow-lg backdrop:bg-black/50"
        onClose={() => setShowDeleteDialog(false)}
      >
        {showDeleteDialog && (
          <div className="flex flex-col gap-lg">
            <h2 className="text-heading2 font-sans font-semibold text-text-primary">
              Delete Document
            </h2>
            <p className="text-body text-text-primary">
              Are you sure you want to delete <strong>{document.name}</strong>? This action is irreversible.
            </p>
            <div className="flex justify-end gap-md">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="rounded-md border border-border-strong px-lg py-sm text-body font-sans font-medium text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded-md bg-signal-critical px-lg py-sm text-body font-sans font-medium text-white"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
