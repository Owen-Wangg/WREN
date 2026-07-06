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
import { useState } from 'react';

import { AiDisclaimerNotice } from '@/components/ui';
import { appConfig } from '@/config/env';

import { useZodForm } from '@/forms/useZodForm';

import { askWrenMessageSchema, type AskWrenMessageFormValues } from '../askWrenSchemas';
import type { AskWrenService } from '../askWrenService';
import type { WrenChatMessage } from '../askWrenTypes';

export interface WrenChatPanelProps {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly askWrenService: AskWrenService;
  readonly className?: string;
}

export function WrenChatPanel({
  documentId,
  draftId,
  draftVersion,
  askWrenService,
  className,
}: WrenChatPanelProps) {
  const [messages, setMessages] = useState<readonly WrenChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useZodForm(askWrenMessageSchema);

  const onSubmit = async ({ text }: AskWrenMessageFormValues) => {
    setError(null);
    const userMessage: WrenChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    reset();

    try {
      const reply = await askWrenService.sendMessage({
        documentId,
        draftId,
        text,
      });
      setMessages((prev) => [...prev, reply]);
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

      <AiDisclaimerNotice message={`Ask ${appConfig.appName} offers questions to help you think through your own draft. It will not rewrite your text for you.`} />

      <p className="text-caption text-text-muted">
        Talking about draft version {draftVersion}.
      </p>

      <ul
        aria-label="Conversation"
        className="flex flex-1 flex-col gap-sm overflow-y-auto"
      >
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

      <form
        className="flex gap-sm"
        noValidate
        onSubmit={handleSubmit(onSubmit)}
      >
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
          disabled={isSubmitting}
          className="rounded-md bg-accent-primary px-md py-sm text-bodySmall font-sans font-semibold text-text-on-accent disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
