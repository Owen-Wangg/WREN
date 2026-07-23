/**
 * `WrenChatPanel` — the Ask WREN chat-style side panel (frontend steering §4
 * known screens: "slides in alongside debrief, doesn't replace it"; task
 * 18.6; Requirement 11.1).
 *
 * Compliance-critical constraints (steering §3, design.md Ask WREN Session
 * State):
 *  - Socratic-only: this component has NO affordance suggesting rewritten
 *    text — no "Apply"/"Insert"/"Rewrite this for me" button, no textarea that
 *    could hold a candidate replacement. The only interactive elements are a
 *    plain-text message list and a single text input for the User's own
 *    question.
 *  - Document-scoped conversation: history persists across draft versions
 *    (Regenerate / Resubmit). New turns still send the *current* `draftId` so
 *    replies are grounded in the latest draft text.
 *  - Surfaces `<AiDisclaimerNotice>` so the AI disclaimer is never
 *    copy-pasted inline here (steering §3, §11).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

import { AiDisclaimerNotice } from '@/components/ui';
import { appConfig } from '@/config/env';

import { useZodForm } from '@/forms/useZodForm';

import { askWrenMessageSchema, type AskWrenMessageFormValues } from '../askWrenSchemas';
import type { AskWrenService } from '../askWrenService';
import type { WrenChatMessage } from '../askWrenTypes';
import {
  computeWritingProgress,
  writingProgressLabel,
  type WritingProgressInput,
} from '../writingProgress';

// Matches: "quoted text" (location hint) — produced by the WREN system prompt.
const QUOTE_PATTERN = /"([^"]{5,120})"\s*\(([^)]{3,40})\)/g;

/**
 * Render assistant message text, turning quoted phrases into clickable spans
 * that highlight the quoted text in the editor via onHighlightText.
 */
function renderMessageText(
  text: string,
  onHighlightText?: (text: string) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  QUOTE_PATTERN.lastIndex = 0;

  while ((match = QUOTE_PATTERN.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const quote = match[1];
    const location = match[2];
    parts.push(
      <button
        key={match.index}
        type="button"
        title={`Click to highlight in document (${location})`}
        onClick={() => onHighlightText?.(quote)}
        className="inline cursor-pointer rounded px-[2px] font-medium underline decoration-dotted underline-offset-2 hover:bg-accent-primary/10 hover:text-accent-primary transition-colors"
      >
        &ldquo;{quote}&rdquo;
        <span className="ml-1 text-[10px] font-normal text-text-muted not-italic">
          ({location})
        </span>
      </button>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length > 0 ? parts : text;
}

function conversationCacheKey(documentId: string): string {
  return `ask-wren-messages:${documentId}`;
}

function legacyDraftCacheKey(documentId: string, draftId: string): string {
  return `ask-wren-messages:${documentId}:${draftId}`;
}

function readCachedMessages(
  documentId: string,
  draftId?: string,
): WrenChatMessage[] | null {
  try {
    const docRaw = sessionStorage.getItem(conversationCacheKey(documentId));
    if (docRaw) {
      const parsed = JSON.parse(docRaw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as WrenChatMessage[];
      }
    }
    if (draftId) {
      const legacyRaw = sessionStorage.getItem(legacyDraftCacheKey(documentId, draftId));
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as WrenChatMessage[];
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedMessages(
  documentId: string,
  messages: readonly WrenChatMessage[],
): void {
  try {
    sessionStorage.setItem(
      conversationCacheKey(documentId),
      JSON.stringify(messages),
    );
  } catch {
    // ignore quota / private mode
  }
}

function mergeMessagesById(
  ...lists: Array<readonly WrenChatMessage[] | null | undefined>
): WrenChatMessage[] {
  const seen = new Set<string>();
  const merged: WrenChatMessage[] = [];
  for (const list of lists) {
    for (const message of list ?? []) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
  }
  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return merged;
}

export type WrenChatProgressSignals = Omit<WritingProgressInput, 'hasAskedCoach'>;

export interface WrenChatPanelProps {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  /**
   * Signals for the progress bar (word count, debrief, revision). Coach
   * engagement is derived from chat messages inside this panel.
   */
  readonly progressSignals?: WrenChatProgressSignals;
  /** @deprecated Prefer `progressSignals`. Kept for tests that pass a fixed %. */
  readonly writingProgressPercent?: number;
  readonly askWrenService: AskWrenService;
  readonly className?: string;
  /** Called when coach response includes a highlight anchor. */
  readonly onHighlight?: (anchorId: string) => void;
  /** Called when the student clicks a quoted phrase to highlight it in the editor. */
  readonly onHighlightText?: (text: string) => void;
}

export function WrenChatPanel({
  documentId,
  draftId,
  draftVersion,
  progressSignals,
  writingProgressPercent,
  askWrenService,
  className,
  onHighlight,
  onHighlightText,
}: WrenChatPanelProps) {
  const [messages, setMessages] = useState<readonly WrenChatMessage[]>(() =>
    documentId ? (readCachedMessages(documentId, draftId) ?? []) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLLIElement | null>(null);

  const computedProgressPercent = useMemo(() => {
    if (!progressSignals) {
      return writingProgressPercent ?? 0;
    }
    return computeWritingProgress({
      ...progressSignals,
      hasAskedCoach: messages.some((m) => m.role === 'user'),
    });
  }, [progressSignals, messages, writingProgressPercent]);

  const [hydrating, setHydrating] = useState(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useZodForm(askWrenMessageSchema);

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setError(null);

    const load = async () => {
      if (!documentId || !draftId || draftId === 'draft-pending') {
        if (!cancelled) {
          setHydrating(false);
        }
        return;
      }

      const cached = readCachedMessages(documentId, draftId);
      if (cached && cached.length > 0 && !cancelled) {
        setMessages((prev) => mergeMessagesById(prev, cached));
      }

      if (!askWrenService.getMessages) {
        if (!cancelled) setHydrating(false);
        return;
      }
      try {
        const prior = await askWrenService.getMessages(documentId, draftId);
        if (!cancelled) {
          const next = mergeMessagesById(messagesRef.current, cached, prior);
          setMessages(next);
          writeCachedMessages(documentId, next);
        }
      } catch {
        // Keep sessionStorage / in-memory messages if the network hydrate fails.
      } finally {
        if (!cancelled) setHydrating(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [askWrenService, documentId, draftId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const onSubmit = async ({ text }: AskWrenMessageFormValues) => {
    if (!draftId || draftId === 'draft-pending') {
      setError('Save a draft before asking about this document.');
      return;
    }

    setError(null);
    const userMessage: WrenChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => {
      const next = [...prev, userMessage];
      writeCachedMessages(documentId, next);
      return next;
    });
    reset();

    try {
      setIsTyping(true);
      const reply = await askWrenService.sendMessage({
        documentId,
        draftId,
        text,
      });
      setIsTyping(false);
      setMessages((prev) => {
        const next = [...prev, reply];
        writeCachedMessages(documentId, next);
        return next;
      });
      if (reply.highlightAnchorId) {
        onHighlight?.(reply.highlightAnchorId);
      }
    } catch (cause) {
      setIsTyping(false);
      setError(
        cause instanceof Error
          ? cause.message
          : `Ask ${appConfig.appName} could not respond right now. Please try again.`,
      );
    }
  };

  return (
    <aside
      aria-label={`Ask ${appConfig.appName}`}
      className={['flex h-full flex-col bg-surface-primary', className]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border-subtle px-lg py-md">
        <div className="flex items-center justify-between">
          <h2 className="text-heading3 font-sans font-semibold text-text-primary">
            Ask {appConfig.appName}
          </h2>
          <span className="text-caption text-text-muted">
            Draft v{draftVersion}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-sm flex items-center gap-sm">
          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-signal-positive transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, computedProgressPercent))}%` }}
              role="progressbar"
              aria-valuenow={computedProgressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Writing progress"
            />
          </div>
          <span className="shrink-0 text-caption text-text-muted">
            {writingProgressLabel(computedProgressPercent)}
          </span>
        </div>
      </div>

      {/* Disclaimer — compact, dismissible */}
      <div className="shrink-0 px-lg pt-md">
        <AiDisclaimerNotice
          dismissible
          dismissStorageKey="ask-chat-ai-disclaimer-dismissed"
          dismissScopeId={documentId}
          message={`${appConfig.appName} responds with guiding questions to help you think through your own writing. It will not rewrite your text or provide replacement prose.`}
        />
      </div>

      {/* Message list */}
      <ul
        aria-label="Conversation"
        className="flex flex-1 flex-col gap-sm overflow-y-auto px-lg py-md"
      >
        {hydrating && messages.length === 0 && (
          <li className="text-caption text-text-muted">Loading…</li>
        )}
        {!hydrating && messages.length === 0 && (
          <li className="flex flex-col gap-xs rounded-lg bg-surface-muted/50 px-md py-sm">
            <span className="text-bodySmall font-semibold text-text-primary">
              What would you like to explore?
            </span>
            <span className="text-caption text-text-muted leading-relaxed">
              Ask about a specific section, your argument structure, or anything
              else on your mind about this draft.
            </span>
          </li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            data-role={message.role}
            className={[
              'max-w-[88%] rounded-2xl px-md py-sm text-bodySmall leading-relaxed',
              message.role === 'user'
                ? 'self-end rounded-br-sm bg-accent-primary text-text-on-accent'
                : 'self-start rounded-bl-sm bg-surface-muted text-text-primary',
            ].join(' ')}
          >
            {message.role === 'wren'
              ? renderMessageText(message.text, onHighlightText)
              : message.text}
          </li>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <li className="self-start rounded-2xl rounded-bl-sm bg-surface-muted px-md py-sm">
            <span className="flex items-center gap-[3px]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-[6px] w-[6px] rounded-full bg-text-muted"
                  style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </span>
          </li>
        )}

        {/* Scroll anchor */}
        <li ref={bottomRef} aria-hidden="true" />
      </ul>

      {error && (
        <p role="alert" className="shrink-0 px-lg pb-xs text-caption text-signal-critical">
          {error}
        </p>
      )}

      {/* Input bar */}
      <form
        className="shrink-0 border-t border-border-subtle px-lg py-md"
        noValidate
        onSubmit={handleSubmit(onSubmit)}
      >
        <label htmlFor="ask-wren-input" className="sr-only">
          Ask {appConfig.appName} a question about this draft
        </label>
        <div className="flex items-end gap-sm rounded-xl border border-border-subtle bg-surface-primary px-md py-sm focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/30 transition-colors">
          <input
            id="ask-wren-input"
            type="text"
            placeholder={`Ask ${appConfig.appName} about this draft…`}
            autoComplete="off"
            className="flex-1 bg-transparent text-bodySmall text-text-primary placeholder:text-text-muted outline-none"
            {...register('text')}
          />
          <button
            type="submit"
            disabled={isSubmitting || draftId === 'draft-pending'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-primary text-text-on-accent transition-opacity disabled:opacity-40"
            aria-label="Send message"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        </div>
      </form>
    </aside>
  );
}
