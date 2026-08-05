/**
 * `<SectionApplicabilityToggle>` — Applicable / Not Applicable vote on one
 * AI Debrief category section.
 *
 * The student can mark any section as "Not Applicable" (e.g. the feedback
 * doesn't apply to their assignment). Votes are persisted anonymously via
 * POST /v1/feedback-section-applicability (upsert semantics — toggling the
 * same category replaces the previous vote). State is optimistic: the UI
 * responds immediately and silently reverts on error.
 *
 * Privacy: no user_id is stored server-side (same pattern as
 * feedback_helpfulness_rating / migration 0009).
 */
import { useCallback, useEffect, useState } from 'react';

import { useRecordSectionApplicability } from '../useDebrief';

export interface SectionApplicabilityToggleProps {
  readonly environmentId: string;
  readonly draftId: string;
  readonly errorCategoryId: string;
  /** Initial vote loaded from the server (undefined = no vote yet). */
  readonly initialVote?: boolean;
}

export function SectionApplicabilityToggle({
  environmentId,
  draftId,
  errorCategoryId,
  initialVote,
}: SectionApplicabilityToggleProps) {
  const [vote, setVote] = useState<boolean | undefined>(initialVote);
  const { mutate, isPending } = useRecordSectionApplicability();

  // Sync with server-loaded initial value (arrives async after first render).
  useEffect(() => {
    setVote(initialVote);
  }, [initialVote]);

  const handleToggle = useCallback(
    (next: boolean) => {
      const prev = vote;
      // Optimistic update.
      setVote(next);
      mutate(
        { environmentId, draftId, errorCategoryId, applicable: next },
        {
          onError: () => {
            // Revert on failure.
            setVote(prev);
          },
        },
      );
    },
    [vote, environmentId, draftId, errorCategoryId, mutate],
  );

  return (
    <div
      className="flex items-center gap-xs shrink-0"
      role="group"
      aria-label="Is this feedback applicable to your writing?"
    >
      <button
        type="button"
        aria-pressed={vote === true}
        disabled={isPending}
        onClick={() => handleToggle(true)}
        className={[
          'rounded-md px-sm py-[2px] text-caption font-sans font-medium transition-colors',
          vote === true
            ? 'bg-signal-positive/15 text-signal-positive border border-signal-positive/40'
            : 'border border-border-subtle text-text-muted hover:border-signal-positive/40 hover:text-signal-positive',
        ].join(' ')}
      >
        Applicable
      </button>
      <button
        type="button"
        aria-pressed={vote === false}
        disabled={isPending}
        onClick={() => handleToggle(false)}
        className={[
          'rounded-md px-sm py-[2px] text-caption font-sans font-medium transition-colors',
          vote === false
            ? 'bg-surface-muted text-text-secondary border border-border-strong'
            : 'border border-border-subtle text-text-muted hover:border-border-strong hover:text-text-secondary',
        ].join(' ')}
      >
        Not Applicable
      </button>
    </div>
  );
}
