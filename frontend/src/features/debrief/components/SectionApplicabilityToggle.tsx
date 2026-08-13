/**
 * `<SectionApplicabilityToggle>` — Thumbs up / Thumbs down vote on one
 * AI Debrief category section.
 *
 * The student can mark any section as applicable (thumbs up, green) or
 * not applicable (thumbs down, red). Votes are persisted anonymously via
 * POST /v1/feedback-section-applicability (upsert semantics — toggling the
 * same category replaces the previous vote). State is optimistic: the UI
 * responds immediately and silently reverts on error.
 *
 * After voting, a brief "Feedback noted" confirmation appears and fades out.
 *
 * Privacy: no user_id is stored server-side (same pattern as
 * feedback_helpfulness_rating / migration 0009).
 */
import { useCallback, useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

import { useRecordSectionApplicability } from '../useDebrief';

export interface SectionApplicabilityToggleProps {
  readonly environmentId: string;
  readonly draftId: string;
  readonly errorCategoryId: string;
  /** Human-readable category name (e.g. "Clarity") shown in the confirmation message. */
  readonly categoryLabel: string;
  /** Initial vote loaded from the server (undefined = no vote yet). */
  readonly initialVote?: boolean;
}

export function SectionApplicabilityToggle({
  environmentId,
  draftId,
  errorCategoryId,
  categoryLabel,
  initialVote,
}: SectionApplicabilityToggleProps) {
  const [vote, setVote] = useState<boolean | undefined>(initialVote);
  const [showAck, setShowAck] = useState(false);
  const { mutate, isPending } = useRecordSectionApplicability();

  // Sync with server-loaded initial value (arrives async after first render).
  useEffect(() => {
    setVote(initialVote);
  }, [initialVote]);

  // Auto-hide the acknowledgment after 2 seconds.
  useEffect(() => {
    if (!showAck) return;
    const timer = setTimeout(() => setShowAck(false), 2000);
    return () => clearTimeout(timer);
  }, [showAck]);

  const handleToggle = useCallback(
    (next: boolean) => {
      const prev = vote;
      // Optimistic update.
      setVote(next);
      setShowAck(true);
      mutate(
        { environmentId, draftId, errorCategoryId, applicable: next },
        {
          onError: () => {
            // Revert on failure.
            setVote(prev);
            setShowAck(false);
          },
        },
      );
    },
    [vote, environmentId, draftId, errorCategoryId, mutate],
  );

  return (
    <div
      className="flex items-center gap-sm shrink-0"
      role="group"
      aria-label="Is this feedback applicable to your writing?"
    >
      <button
        type="button"
        aria-pressed={vote === true}
        aria-label="Applicable"
        disabled={isPending}
        onClick={() => handleToggle(true)}
        className={[
          'rounded-full p-[6px] transition-colors',
          vote === true
            ? 'bg-green-100 text-green-600'
            : 'text-text-muted hover:bg-green-50 hover:text-green-600',
        ].join(' ')}
      >
        <ThumbsUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-pressed={vote === false}
        aria-label="Not Applicable"
        disabled={isPending}
        onClick={() => handleToggle(false)}
        className={[
          'rounded-full p-[6px] transition-colors',
          vote === false
            ? 'bg-red-100 text-red-600'
            : 'text-text-muted hover:bg-red-50 hover:text-red-600',
        ].join(' ')}
      >
        <ThumbsDown size={16} aria-hidden="true" />
      </button>
      {showAck && (
        <span
          className={[
            'text-xs font-sans transition-opacity duration-300',
            vote === true ? 'text-green-600' : vote === false ? 'text-red-600' : 'text-text-muted',
          ].join(' ')}
        >
          {categoryLabel} {vote === true ? 'applicable' : 'not applicable'}
        </span>
      )}
    </div>
  );
}
