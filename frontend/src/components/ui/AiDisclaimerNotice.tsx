/**
 * `<AiDisclaimerNotice>` — the reusable AI-generated-feedback disclaimer notice
 * (Requirement 1.2; frontend steering §3, §9, §11).
 *
 * Must be the single place this copy lives — never copy-pasted inline on the
 * dashboard, debrief modal, or chat panel (steering §11 "Don't let the AI
 * disclaimer notice be copy-pasted text in multiple places"). Visually calm: a
 * neutral card using the `notice*` tokens, not a warning-yellow banner
 * (steering §9 "Keep the AI disclaimer/notice visually calm ... unless
 * legal/compliance specifically asks for more visual urgency").
 *
 * Rendered as a `role="note"` region (semantic HTML first, ARIA only where
 * semantic HTML can't express it — steering §8) so assistive tech announces it
 * as supplementary information rather than an alert/warning.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export interface AiDisclaimerNoticeProps {
  /** Override the default copy (e.g. a shorter variant for a compact panel). */
  readonly message?: string;
  readonly className?: string;
  /**
   * When true, shows a dismiss control. Dismissal is remembered in
   * `localStorage` under {@link dismissStorageKey} (defaults to a shared key).
   */
  readonly dismissible?: boolean;
  /** localStorage key used when `dismissible` is true. */
  readonly dismissStorageKey?: string;
}

export const AI_DISCLAIMER_DEFAULT_MESSAGE =
  'The feedback provided by the application is AI-generated and consists of questions and observations to guide your own revision. It will never rewrite your text. Always use your own judgment and consult a field expert when in doubt.';

const DEFAULT_DISMISS_KEY = 'wren-ai-disclaimer-dismissed';

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function AiDisclaimerNotice({
  message = AI_DISCLAIMER_DEFAULT_MESSAGE,
  className,
  dismissible = false,
  dismissStorageKey = DEFAULT_DISMISS_KEY,
}: AiDisclaimerNoticeProps) {
  const [dismissed, setDismissed] = useState(() =>
    dismissible ? readDismissed(dismissStorageKey) : false,
  );

  if (dismissible && dismissed) {
    return null;
  }

  return (
    <div
      role="note"
      className={[
        'relative rounded-md border border-notice-border bg-notice-surface px-md py-sm text-bodySmall text-text-secondary',
        dismissible ? 'pr-10' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {message}
      {dismissible && (
        <button
          type="button"
          onClick={() => {
            writeDismissed(dismissStorageKey);
            setDismissed(true);
          }}
          aria-label="Dismiss disclaimer"
          className="absolute right-sm top-sm rounded-md p-xs text-text-muted hover:bg-surface-muted hover:text-text-primary"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
