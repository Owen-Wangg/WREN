/**
 * `<FeedbackHelpfulnessPrompt>` — Yes/No + optional comment helpfulness rating
 * (task 18.3; design.md known-screens table `FeedbackHelpfulnessPrompt`;
 * Requirements 16.1–16.5).
 *
 * Submitting calls `recordFeedbackHelpfulness` (via `useFeedbackHelpfulness`),
 * the stubbed audit-event call site described by the design/steering ("UI
 * emits audit-relevant events ... helpfulness rating ... so they can be
 * logged"). The real Audit_Service (task 14) doesn't exist yet, so this is a
 * mock API method call today — the call site and event shape already match
 * what Audit_Service will eventually receive.
 *
 * Semantic HTML first (steering §8): a native `<fieldset>`/`<legend>` group for
 * the Yes/No choice (two `<button role="radio">`-free plain buttons announced
 * via `aria-pressed`), a `<label>`ed `<textarea>` for the optional comment, and
 * the submission outcome announced via `role="status"`.
 */
import { useState } from 'react';

import { useFeedbackHelpfulness } from '../useDebrief';

export interface FeedbackHelpfulnessPromptProps {
  readonly environmentId: string;
  readonly draftId: string;
  readonly className?: string;
}

export function FeedbackHelpfulnessPrompt({
  environmentId,
  draftId,
  className,
}: FeedbackHelpfulnessPromptProps) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const { mutate, isPending, isSuccess, isError } = useFeedbackHelpfulness();

  const handleSubmit = () => {
    if (helpful === null) return;
    mutate({
      environmentId,
      draftId,
      helpful,
      comment: comment.trim() ? comment.trim() : undefined,
    });
  };

  if (isSuccess) {
    return (
      <p role="status" className={['text-bodySmall text-text-secondary', className].filter(Boolean).join(' ')}>
        Thanks for letting us know.
      </p>
    );
  }

  return (
    <fieldset
      className={['flex flex-col gap-sm border-t border-border-subtle pt-md', className]
        .filter(Boolean)
        .join(' ')}
    >
      <legend className="text-body font-sans italic text-text-secondary">
        Was this feedback helpful?
      </legend>

      <div className="flex gap-sm" role="group" aria-label="Was this feedback helpful?">
        <button
          type="button"
          aria-pressed={helpful === true}
          onClick={() => setHelpful(true)}
          className={[
            'rounded-md px-lg py-sm text-body font-sans font-semibold',
            helpful === true
              ? 'bg-accent-primary text-text-on-accent'
              : 'bg-accent-primary text-text-on-accent opacity-70',
          ].join(' ')}
        >
          Yes
        </button>
        <button
          type="button"
          aria-pressed={helpful === false}
          onClick={() => setHelpful(false)}
          className={[
            'rounded-md px-lg py-sm text-body font-sans font-semibold',
            helpful === false
              ? 'bg-accent-primary text-text-on-accent'
              : 'bg-accent-primary text-text-on-accent opacity-70',
          ].join(' ')}
        >
          No
        </button>
      </div>

      <div className="flex flex-col gap-xs">
        <label
          htmlFor="feedback-helpfulness-comment"
          className="text-caption text-text-muted"
        >
          Optional comment
        </label>
        <textarea
          id="feedback-helpfulness-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          className="rounded-md border border-border-strong bg-surface-primary px-sm py-xs text-bodySmall text-text-primary"
        />
      </div>

      {isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Couldn't record your rating. Please try again.
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={helpful === null || isPending}
        className="self-start rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-60"
      >
        {isPending ? 'Submitting…' : 'Submit'}
      </button>
    </fieldset>
  );
}
