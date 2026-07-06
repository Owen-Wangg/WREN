/**
 * `<StatusBadge>` — renders a Document status via the `statusColorMap` lookup
 * (Requirement 1.2). Never applies color/icon-only signaling: the label text
 * is always rendered (accessibility baseline, frontend steering §8), and the
 * color is additive, not load-bearing.
 */
import { getStatusColorEntry } from './statusColorMap';

import type { DocumentStatus } from '@wren/types';

export interface StatusBadgeProps {
  readonly status: DocumentStatus;
  readonly className?: string;
}

const surfaceClassByToken: Record<string, string> = {
  statusDraftingSurface: 'bg-status-drafting-surface',
  statusPolishingSurface: 'bg-status-polishing-surface',
};

const textClassByToken: Record<string, string> = {
  statusDrafting: 'text-status-drafting',
  statusPolishing: 'text-status-polishing',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const entry = getStatusColorEntry(status);

  return (
    <span
      className={[
        'inline-flex items-center gap-xs rounded-full px-sm py-xs text-bodySmall font-sans font-semibold',
        surfaceClassByToken[entry.surfaceToken],
        textClassByToken[entry.colorToken],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Text-equivalent is the entire badge content — never color/icon alone. */}
      {entry.label}
    </span>
  );
}
