/**
 * `<WriterProgressPanel>` — connected wrapper that fetches the writer progress
 * summary for a writing environment and renders it *ahead of* the remaining
 * feedback items (task 18.4; Requirement 18.1).
 *
 * Isolated to `features/progress/` (not wired into `features/debrief/` here) to
 * avoid file collisions with the parallel B-wave tasks. A consumer (the debrief
 * / feedback view) places this panel above its feedback list; the panel owns
 * the "show a progress summary before remaining items" placement, while the
 * pure `<WriterProgressSummary>` owns the draft-anchoring gate and the
 * no-numeric-scoring rendering contract.
 *
 * The progress summary is supplementary: while it loads or if it fails, the
 * panel renders nothing rather than blocking the feedback the writer came to
 * see. On the first draft the underlying `<WriterProgressSummary>` renders
 * nothing (version < 2), so the writer sees no progress region until a prior
 * draft exists (Requirements 18.1, 18.5).
 */
import { WriterProgressSummary } from './WriterProgressSummary';

import { useWriterProgressSummary } from '../useProgressSummary';

export interface WriterProgressPanelProps {
  readonly environmentId: string;
  readonly className?: string;
}

export function WriterProgressPanel({
  environmentId,
  className,
}: WriterProgressPanelProps) {
  const { data, isLoading, isError } = useWriterProgressSummary(environmentId);

  if (isLoading || isError || !data) {
    return null;
  }

  return <WriterProgressSummary summary={data} className={className} />;
}
