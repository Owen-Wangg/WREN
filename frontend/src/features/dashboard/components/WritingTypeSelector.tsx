/**
 * `<WritingTypeSelector>` — writer self-selection of Writing Types (task 19.1;
 * Requirements 4.2, 4.6, 6.8, 28.2).
 *
 * Renders the resolved Writing Type catalog (see {@link resolveWritingTypeCatalog}).
 * A Writing Type whose effective access is OPEN, or LOCKED-but-granted, is
 * `selectable`: the writer self-selects it to start a document (Requirements
 * 4.2, 6.8). A LOCKED type with no applicable grant is never silently blocked —
 * it offers a "Request access" action instead (Requirement 4.6).
 *
 * Presentational and pure: it takes an already-resolved catalog and emits
 * `onSelect` / `onRequestAccess` callbacks, so the branching (which the
 * `writingTypeAccess` helpers own) stays unit-testable and the connected
 * `<WriterDashboard>` owns the query/mutation wiring.
 */
import type { ResolvedWritingType, WritingTypeAccessStatus } from '../writingTypeAccess';

import type { WritingType } from '@wren/types';

/** Writer-facing, qualitative hint per access status (never numeric). */
const ACCESS_STATUS_LABEL: Record<WritingTypeAccessStatus, string> = {
  open: 'Open — select to start writing',
  granted: 'Access granted — select to start writing',
  locked: 'Locked — request access to start writing',
};

export interface WritingTypeSelectorProps {
  readonly resolvedWritingTypes: readonly ResolvedWritingType[];
  /** Self-select an OPEN / granted Writing Type to start a document. */
  readonly onSelect: (writingType: WritingType) => void;
  /** Request access to a LOCKED Writing Type (never silently blocked). */
  readonly onRequestAccess: (writingType: WritingType) => void;
  /** The Writing Type id whose access request is currently in flight, if any. */
  readonly requestingWritingTypeId?: string;
  /** Writing Type ids the writer has already requested access to this session. */
  readonly requestedWritingTypeIds?: readonly string[];
}

export function WritingTypeSelector({
  resolvedWritingTypes,
  onSelect,
  onRequestAccess,
  requestingWritingTypeId,
  requestedWritingTypeIds = [],
}: WritingTypeSelectorProps) {
  if (resolvedWritingTypes.length === 0) {
    return (
      <p className="text-bodySmall text-text-secondary">
        No writing types are available to you yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-sm">
      {resolvedWritingTypes.map(({ writingType, status, selectable }) => {
        const alreadyRequested = requestedWritingTypeIds.includes(writingType.id);
        const isRequesting = requestingWritingTypeId === writingType.id;

        return (
          <li
            key={writingType.id}
            className="flex items-center justify-between gap-sm rounded-md border border-border-subtle bg-surface-primary px-md py-sm"
          >
            <div className="flex flex-col gap-xs">
              <span className="text-body font-sans font-medium text-text-primary">
                {writingType.name}
              </span>
              <span className="text-caption text-text-muted">
                {ACCESS_STATUS_LABEL[status]}
              </span>
            </div>

            {selectable ? (
              <button
                type="button"
                onClick={() => onSelect(writingType)}
                className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent"
              >
                Start a document
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRequestAccess(writingType)}
                disabled={alreadyRequested || isRequesting}
                className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {alreadyRequested
                  ? 'Access requested'
                  : isRequesting
                    ? 'Requesting…'
                    : 'Request access'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
