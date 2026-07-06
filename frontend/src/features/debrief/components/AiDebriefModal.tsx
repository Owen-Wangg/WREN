/**
 * `<AiDebriefModal>` — the AI Debrief / structural-feedback view (task 18.3;
 * design.md known-screens table `AiDebriefModal`; Requirements 11.2, 14.2,
 * 16.1–16.5, 48.2, 48.3).
 *
 * Built on Radix UI's `Dialog` primitive rather than hand-rolled focus-trap
 * logic (frontend steering §8, §9: "for accessible behavior (focus trap,
 * keyboard nav) in things like `AiDebriefModal`, don't hand-roll this"). Radix
 * `Dialog` traps focus, closes on Escape, and returns focus to the triggering
 * element on close — the compliance behavior task 18.7 asserts explicitly.
 *
 * Content is anchored to a specific draft version (`draftId`), never rendered
 * generically (frontend steering §11 "Don't build a single generic `<Modal>`
 * usage for the AI Debrief without anchoring it to a specific draft version
 * reference").
 *
 * **No-ghostwriting compliance (hard requirement):** this component and every
 * child it renders (`FeedbackItemsList`, `FeedbackHelpfulnessPrompt`) contain
 * no Apply/Insert/Accept affordance. The only actions here are "Regenerate AI
 * Debrief" (re-runs the engine) and the helpfulness Yes/No — neither inserts
 * text into the writer's draft.
 *
 * Inline vs. structural feedback are rendered as two visually and structurally
 * separate sections (Requirement 14.2) rather than a single flat list, so a
 * `kind === 'structural'` item is never mistaken for an anchored inline item.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { FeedbackItemsList } from './FeedbackItemsList';
import { FeedbackHelpfulnessPrompt } from './FeedbackHelpfulnessPrompt';

import { useAiDebrief, useRegenerateDebrief } from '../useDebrief';

import { AiDisclaimerNotice } from '@/components/ui';

import type { FeedbackItem } from '@wren/types';

export interface AiDebriefModalProps {
  readonly environmentId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AiDebriefModal({
  environmentId,
  open,
  onOpenChange,
}: AiDebriefModalProps) {
  const debriefQuery = useAiDebrief(environmentId);
  const regenerate = useRegenerateDebrief(environmentId);

  // Track the element that had focus when the modal opened so we can return
  // focus to it on close (accessibility steering §8: "return focus to the
  // triggering button on close"). Radix Dialog handles this automatically when
  // using Dialog.Trigger, but in controlled mode with an external trigger it
  // needs an explicit assist.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (previousFocusRef.current) {
      // Restore focus after the DOM has settled (Radix unmounts the portal).
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      requestAnimationFrame(() => target.focus());
    }
  }, [open]);

  const debrief = debriefQuery.data;

  // Group items by errorCategoryId to match the category-based layout (Content,
  // Organization, Clarity, etc.) shown in the design mockup.
  const groupedByCategory = (debrief?.items ?? []).reduce<
    Record<string, FeedbackItem[]>
  >((acc, item) => {
    const key = item.errorCategoryId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
  const categoryKeys = Object.keys(groupedByCategory);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 flex max-h-[80vh] w-full max-w-[620px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border-strong bg-surface-primary p-xl shadow-lg"
          aria-describedby={undefined}
        >
          <div className="mb-lg flex items-start justify-between">
            <div className="flex flex-col gap-xs">
              <Dialog.Title className="text-heading2 font-sans font-semibold text-text-primary">
                AI Debrief
              </Dialog.Title>
              <p className="text-body text-text-secondary">
                Feedback on your written work.
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close AI Debrief"
                className="rounded-md p-xs text-text-muted hover:text-text-primary"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <AiDisclaimerNotice className="mb-lg" />

          <div className="mb-lg flex items-center justify-between">
            <span className="text-caption text-text-muted">
              {debrief ? `Based on draft ${debrief.draftId}` : ' '}
            </span>
            <button
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending || debriefQuery.isLoading}
              className="rounded-md border border-border-strong bg-surface-primary px-lg py-xs text-bodySmall font-sans font-semibold text-text-primary disabled:opacity-60"
            >
              {regenerate.isPending ? 'Regenerating…' : 'Regenerate AI Debrief'}
            </button>
          </div>

          {debriefQuery.isLoading && (
            <p role="status" className="text-bodySmall text-text-secondary">
              Loading AI Debrief…
            </p>
          )}

          {debriefQuery.isError && (
            <div role="alert" className="flex flex-col gap-sm">
              <p className="text-bodySmall text-signal-critical">
                Something went wrong loading the AI Debrief.
              </p>
              <button
                type="button"
                onClick={() => debriefQuery.refetch()}
                className="self-start rounded-md border border-border-strong px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
              >
                Retry
              </button>
            </div>
          )}

          {regenerate.isError && (
            <p role="alert" className="mb-sm text-bodySmall text-signal-critical">
              Couldn't regenerate the AI Debrief. Please try again.
            </p>
          )}

          {debrief && !debriefQuery.isLoading && !debriefQuery.isError && (
            <>
              {debrief.items.length === 0 ? (
                <p className="text-bodySmall text-text-secondary">
                  Feedback hasn't been generated for this document yet.
                </p>
              ) : (
                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto rounded-md border border-border-strong/25 p-lg shadow-md">
                    <div className="flex flex-col gap-lg">
                      {categoryKeys.map((category) => (
                        <section
                          key={category}
                          aria-labelledby={`ai-debrief-category-${category}`}
                        >
                          <h3
                            id={`ai-debrief-category-${category}`}
                            className="mb-sm text-bodySmall font-sans font-semibold text-text-primary"
                          >
                            {category}
                          </h3>
                          <FeedbackItemsList
                            items={groupedByCategory[category]}
                            emptyMessage=""
                          />
                        </section>
                      ))}
                    </div>
                  </div>

                  <FeedbackHelpfulnessPrompt
                    environmentId={environmentId}
                    draftId={debrief.draftId}
                    className="mt-lg"
                  />
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
