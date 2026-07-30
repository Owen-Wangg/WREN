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
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export interface AiDisclaimerNoticeProps {
  /** Override the default copy (e.g. a shorter variant for a compact panel). */
  readonly message?: string;
  readonly className?: string;
  /**
   * When true, shows a dismiss control. Dismissal is remembered in
   * `sessionStorage` under {@link dismissStorageKey} (optionally scoped by
   * {@link dismissScopeId}) for the current browser tab session only — not
   * permanently across visits.
   */
  readonly dismissible?: boolean;
  /** sessionStorage key prefix used when `dismissible` is true. */
  readonly dismissStorageKey?: string;
  /**
   * Scopes dismissal (e.g. document id) so closing the notice on one document
   * does not hide it on another during the same session.
   */
  readonly dismissScopeId?: string;
}

export const AI_DISCLAIMER_DEFAULT_MESSAGE =
  'The feedback provided by the application is AI-generated and consists of questions and observations to guide your own revision. It will never rewrite your text. Always use your own judgment and consult an expert when in doubt.';

const DEFAULT_DISMISS_KEY = 'wren-ai-disclaimer-dismissed';

function storageKeyFor(baseKey: string, scopeId?: string): string {
  return scopeId ? `${baseKey}:${scopeId}` : baseKey;
}

function readDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function AiDisclaimerNotice({
  message = AI_DISCLAIMER_DEFAULT_MESSAGE,
  className,
  dismissible = false,
  dismissStorageKey = DEFAULT_DISMISS_KEY,
  dismissScopeId,
}: AiDisclaimerNoticeProps) {
  const storageKey = storageKeyFor(dismissStorageKey, dismissScopeId);
  const [dismissed, setDismissed] = useState(() =>
    dismissible ? readDismissed(storageKey) : false,
  );

  useEffect(() => {
    if (!dismissible) {
      setDismissed(false);
      return;
    }
    setDismissed(readDismissed(storageKey));
  }, [dismissible, storageKey]);

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
            writeDismissed(storageKey);
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
