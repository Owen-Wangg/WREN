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
 *  - Draft-anchored: requires `draftId`/`draftVersion` props so every message
 *    sent through this panel is scoped to one specific Draft (never "the
 *    document" generically).
 *  - Surfaces `<AiDisclaimerNotice>` so the AI disclaimer is never
 *    copy-pasted inline here (steering §3, §11).
 */
import { useState, useEffect } from 'react';

import { AiDisclaimerNotice } from '@/components/ui';
import { appConfig } from '@/config/env';

import { useZodForm } from '@/forms/useZodForm';

import { askWrenMessageSchema, type AskWrenMessageFormValues } from '../askWrenSchemas';
import type { AskWrenService } from '../askWrenService';
import type { WrenChatMessage } from '../askWrenTypes';

function conversationCacheKey(documentId: string, draftId: string): string {
  return `ask-wren-messages:${documentId}:${draftId}`;
}

function readCachedMessages(
  documentId: string,
  draftId: string,
): WrenChatMessage[] | null {
  try {
    const raw = sessionStorage.getItem(conversationCacheKey(documentId, draftId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as WrenChatMessage[]) : null;
  } catch {
    return null;
  }
}

function writeCachedMessages(
  documentId: string,
  draftId: string,
  messages: readonly WrenChatMessage[],
): void {
  try {
    sessionStorage.setItem(
      conversationCacheKey(documentId, draftId),
      JSON.stringify(messages),
    );
  } catch {
    // ignore quota / private mode
  }
}

export interface WrenChatPanelProps {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly askWrenService: AskWrenService;
  readonly className?: string;
  /** Called when coach response includes a highlight anchor. */
  readonly onHighlight?: (anchorId: string) => void;
}

export function WrenChatPanel({
  documentId,
  draftId,
  draftVersion,
  askWrenService,
  className,
  onHighlight,
}: WrenChatPanelProps) {
  const [messages, setMessages] = useState<readonly WrenChatMessage[]>(() =>
    draftId && draftId !== 'draft-pending'
      ? (readCachedMessages(documentId, draftId) ?? [])
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
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
      if (!draftId || draftId === 'draft-pending') {
        if (!cancelled) {
          setMessages([]);
          setHydrating(false);
        }
        return;
      }

      const cached = readCachedMessages(documentId, draftId);
      if (cached && cached.length > 0 && !cancelled) {
        setMessages(cached);
      }

      if (!askWrenService.getMessages) {
        if (!cancelled) setHydrating(false);
        return;
      }
      try {
        const prior = await askWrenService.getMessages(documentId, draftId);
        if (!cancelled) {
          setMessages(prior);
          writeCachedMessages(documentId, draftId, prior);
        }
      } catch {
        // Keep sessionStorage cache if the network/API hydrate fails.
      } finally {
        if (!cancelled) setHydrating(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [askWrenService, documentId, draftId]);

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
      writeCachedMessages(documentId, draftId, next);
      return next;
    });
    reset();

    try {
      const reply = await askWrenService.sendMessage({
        documentId,
        draftId,
        text,
      });
      setMessages((prev) => {
        const next = [...prev, reply];
        writeCachedMessages(documentId, draftId, next);
        return next;
      });
      if (reply.highlightAnchorId) {
        onHighlight?.(reply.highlightAnchorId);
      }
    } catch (cause) {
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
      className={[
        'flex h-full w-[320px] shrink-0 flex-col gap-md rounded-md border border-border-subtle bg-surface-panel p-lg',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h2 className="text-heading3 font-sans font-semibold text-text-primary">
        Ask {appConfig.appName}
      </h2>

      <div className="flex flex-col gap-xs">
        <span className="text-bodySmall font-sans font-semibold text-text-primary">
          Draft version {draftVersion}
        </span>
        <div className="h-[6px] w-full overflow-hidden rounded-full bg-surface-subtle">
          <div
            className="h-full rounded-full bg-signal-positive transition-all duration-300"
            style={{ width: `${Math.min((draftVersion / 3) * 100, 100)}%` }}
            role="progressbar"
            aria-valuenow={draftVersion}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-label="Draft progress"
          />
        </div>
      </div>

      <AiDisclaimerNotice
        message={`${appConfig.appName} responds with guiding questions to help you think through your own writing. It will not rewrite your text or provide replacement prose.`}
      />

      <ul
        aria-label="Conversation"
        className="flex flex-1 flex-col gap-sm overflow-y-auto"
      >
        {hydrating && messages.length === 0 && (
          <li className="text-bodySmall text-text-secondary">Loading conversation…</li>
        )}
        {!hydrating && messages.length === 0 && (
          <li className="text-bodySmall text-text-secondary">
            Ask a question about this draft to get started.
          </li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            data-role={message.role}
            className={[
              'max-w-[85%] rounded-md px-md py-sm text-bodySmall',
              message.role === 'user'
                ? 'self-end bg-surface-subtle text-text-primary'
                : 'self-start bg-notice-surface text-text-secondary',
            ].join(' ')}
          >
            {message.text}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          {error}
        </p>
      )}

      <form className="flex gap-sm" noValidate onSubmit={handleSubmit(onSubmit)}>
        <label htmlFor="ask-wren-input" className="sr-only">
          Ask {appConfig.appName} a question about this draft
        </label>
        <input
          id="ask-wren-input"
          type="text"
          placeholder="Ask a question about this draft…"
          className="flex-1 rounded-md border border-border-subtle bg-surface-primary px-md py-sm text-bodySmall text-text-primary placeholder:text-text-primary/50"
          {...register('text')}
        />
        <button
          type="submit"
          disabled={isSubmitting || draftId === 'draft-pending'}
          className="rounded-md bg-accent-primary px-md py-sm text-bodySmall font-sans font-semibold text-text-on-accent disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
