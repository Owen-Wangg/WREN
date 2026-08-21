/**
 * `<AiDebriefModal>` — the AI Debrief / structural-feedback view (task 18.3;
 * design.md known-screens table `AiDebriefModal`; Requirements 11.2, 14.2,
 * 16.1–16.5, 48.2, 48.3).
 *
 * Built on Radix UI's `Dialog` primitive in non-modal mode so the panel can
 * coexist with the writing coach chat panel. The header acts as a drag handle
 * allowing the user to reposition the panel. Closes on Escape and returns
 * focus to the triggering element on close.
 *
 * Content is anchored to a specific draft version (`draftId`), never rendered
 * generically (frontend steering §11 "Don't build a single generic `<Modal>`
 * usage for the AI Debrief without anchoring it to a specific draft version
 * reference").
 *
 * **No-ghostwriting compliance (hard requirement):** this component and every
 * child it renders (`FeedbackItemsList`, `FeedbackHelpfulnessPrompt`) contain
 * no Apply/Insert/Accept affordance. The only action here is the helpfulness
 * Yes/No — it does not insert text into the writer's draft.
 *
 * Inline vs. structural feedback are rendered as two visually and structurally
 * separate sections (Requirement 14.2) rather than a single flat list, so a
 * `kind === 'structural'` item is never mistaken for an anchored inline item.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUp, CheckCircle2, Minus, Star, TrendingUp, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AiDisclaimerNotice } from '@/components/ui';
import { useDocuments, useOrganizations, useWritingTypes } from '@/features/dashboard/useDashboard';

import { FeedbackHelpfulnessPrompt } from './FeedbackHelpfulnessPrompt';

import { useAiDebrief, useRegenerateDebrief } from '../useDebrief';

import type { ProgressPattern } from '../debriefTypes';
import type { FeedbackItem } from '@wren/types';

export interface AiDebriefModalProps {
  readonly environmentId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly autoRegenerate?: boolean;
  /** Feedback item id of the quote currently highlighted in the editor. */
  readonly activeQuoteId?: string;
  /** Called when student clicks a quoted text to highlight it in the document. */
  readonly onQuoteClick?: (selection: {
    feedbackItemId: string;
    anchorId?: string;
    quotedText?: string;
    resolvedHighlight?: { paragraphIndex: number; startOffset: number; endOffset: number };
  }) => void;
}

function buildDebriefDisclaimer(departmentName?: string): string {
  const expert = departmentName
    ? `an expert in ${departmentName}`
    : 'an expert in your department';
  return `The following content is AI generated and should be considered as suggestions. This system will always provide feedback, and it may not always be applicable, so please use your judgement when considering this feedback. If you have questions about the feedback provided to you in this debrief, please reach out to ${expert}.`;
}

export function AiDebriefModal({
  environmentId,
  open,
  onOpenChange,
  autoRegenerate = false,
  activeQuoteId,
  onQuoteClick,
}: AiDebriefModalProps) {
  const debriefQuery = useAiDebrief(environmentId);
  const regenerate = useRegenerateDebrief(environmentId);

  const { data: documents } = useDocuments();
  const { data: writingTypes } = useWritingTypes();
  const { data: organizations } = useOrganizations();
  const currentDoc = documents?.find((d) => d.id === environmentId);
  const writingType = writingTypes?.find((wt) => wt.id === currentDoc?.documentTypeId);
  const organization = organizations?.find((org) => org.id === writingType?.organizationId);
  const departmentName = organization?.name;

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const didAutoRegenerate = useRef(false);
  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget.closest('[data-debrief-panel]') as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      if (autoRegenerate && !didAutoRegenerate.current) {
        didAutoRegenerate.current = true;
        regenerateRef.current.mutate();
      }
    } else {
      didAutoRegenerate.current = false;
      setPosition(null);
      if (previousFocusRef.current) {
        const target = previousFocusRef.current;
        previousFocusRef.current = null;
        requestAnimationFrame(() => target.focus());
      }
    }
  }, [open, autoRegenerate]);

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

  const positionStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y, transform: 'none' }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          data-debrief-panel=""
          className="fixed z-50 flex max-h-[85vh] w-full max-w-[680px] flex-col rounded-xl border border-border-strong bg-surface-primary shadow-lg"
          style={positionStyle}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* Fixed header — drag handle */}
          <div
            className="flex cursor-move items-start justify-between border-b border-border-subtle px-xl pt-xl pb-lg select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div className="flex flex-col gap-xs">
              <Dialog.Title className="text-heading2 font-sans font-bold text-text-primary">
                AI Debrief
              </Dialog.Title>
              <p className="text-body text-text-secondary">
                {debrief?.progressSummary && debrief.progressSummary.length > 0
                  ? 'Feedback on your written work. See your progress since the last draft below.'
                  : 'Feedback on your written work.'}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close AI Debrief"
                className="rounded-md p-xs text-text-muted hover:text-text-primary"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable content area */}
          <div className="relative min-h-0 flex-1 overflow-y-auto px-xl py-lg">
            {/* Regeneration loading overlay */}
            {regenerate.isPending && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-md bg-surface-primary/80 backdrop-blur-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-strong border-t-accent-primary" />
                <p role="status" className="text-bodySmall font-sans font-medium text-text-secondary">
                  Regenerating feedback…
                </p>
              </div>
            )}

            <AiDisclaimerNotice
              dismissible
              dismissStorageKey="ai-debrief-disclaimer-dismissed"
              dismissScopeId={environmentId}
              message={buildDebriefDisclaimer(departmentName)}
              className="mb-xl leading-relaxed"
            />

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
                  <div className="flex flex-col gap-xl">
                    {/* Progress Summary Card (REQ-PROGRESS-ACK-01) — shown before feedback when >= 2 drafts */}
                    {debrief.progressSummary && debrief.progressSummary.length > 0 && (
                      <section aria-labelledby="progress-card-heading">
                        {/* Top-level counts card */}
                        <div className="mb-md rounded-lg border border-accent-primary/20 bg-accent-primary/5 p-lg">
                          <h3 id="progress-card-heading" className="mb-md flex items-center gap-sm text-heading3 font-sans font-semibold text-text-primary">
                            <TrendingUp size={20} className="text-signal-positive" aria-hidden="true" />
                            Your Progress This Draft
                          </h3>
                          <div className="flex flex-col gap-md">
                            {(() => {
                              const improving = debrief.progressSummary.filter(p => p.tendency === 'improving').length;
                              const persistent = debrief.progressSummary.filter(p => p.tendency === 'persistent').length;
                              const emerging = debrief.progressSummary.filter(p => p.tendency === 'emerging').length;
                              const topImprovement = debrief.progressSummary.find(p => p.tendency === 'improving');

                              return (
                                <>
                                  <div className="flex items-center gap-lg">
                                    <div className="flex items-center gap-sm">
                                      <ArrowUp size={16} className="text-signal-positive" aria-hidden="true" />
                                      <span className="text-bodySmall font-sans font-semibold text-text-primary">{improving} Improving</span>
                                    </div>
                                    <span className="text-text-muted">|</span>
                                    <div className="flex items-center gap-sm">
                                      <Minus size={16} className="text-signal-caution" aria-hidden="true" />
                                      <span className="text-bodySmall font-sans font-semibold text-text-primary">{persistent} Persistent</span>
                                    </div>
                                    <span className="text-text-muted">|</span>
                                    <div className="flex items-center gap-sm">
                                      <Star size={16} className="text-accent-primary" aria-hidden="true" />
                                      <span className="text-bodySmall font-sans font-semibold text-text-primary">{emerging} Emerging</span>
                                    </div>
                                  </div>
                                  {topImprovement && (
                                    <p className="text-bodySmall font-sans font-medium text-signal-positive">
                                      Keep the momentum on "{topImprovement.category}"
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Detailed patterns below */}
                        <div className="flex flex-col gap-md">
                          {debrief.progressSummary.map((pattern: ProgressPattern) => (
                            <div
                              key={pattern.category}
                              className="flex items-start gap-md rounded-md border border-border-subtle bg-surface-muted/30 p-md"
                            >
                              <div className="mt-[2px] shrink-0">
                                {pattern.tendency === 'improving' && (
                                  <ArrowUp size={16} className="text-signal-positive" aria-hidden="true" />
                                )}
                                {pattern.tendency === 'persistent' && (
                                  <Minus size={16} className="text-signal-caution" aria-hidden="true" />
                                )}
                                {pattern.tendency === 'nearly_resolved' && (
                                  <CheckCircle2 size={16} className="text-signal-positive" aria-hidden="true" />
                                )}
                                {pattern.tendency === 'emerging' && (
                                  <Star size={16} className="text-accent-primary" aria-hidden="true" />
                                )}
                              </div>
                              <div className="flex flex-col gap-xs">
                                <div className="flex items-center gap-sm">
                                  <span className="text-bodySmall font-sans font-semibold text-text-primary">
                                    {pattern.category}
                                  </span>
                                  <span className={`rounded-full px-sm py-[1px] text-caption font-sans font-medium ${
                                    pattern.tendency === 'improving'
                                      ? 'bg-signal-positive/10 text-signal-positive'
                                      : pattern.tendency === 'persistent'
                                        ? 'bg-signal-caution/10 text-signal-caution'
                                        : pattern.tendency === 'nearly_resolved'
                                          ? 'bg-signal-positive/10 text-signal-positive'
                                          : 'bg-accent-primary/10 text-accent-primary'
                                  }`}>
                                    {pattern.tendency === 'nearly_resolved' ? 'nearly there' : pattern.tendency}
                                  </span>
                                </div>
                                <p className="text-bodySmall leading-relaxed text-text-secondary">
                                  {pattern.description}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Category sections */}
                    {categoryKeys.map((category) => {
                      const items = groupedByCategory[category];
                      const doneWell = items.filter((i) => i.kind === 'structural');
                      const improvements = items.filter((i) => i.kind === 'inline');
                      const categoryLabel = debrief.categoryNames?.[category] ?? category;

                      return (
                        <section
                          key={category}
                          aria-labelledby={`ai-debrief-category-${category}`}
                        >
                          <h3
                            id={`ai-debrief-category-${category}`}
                            className="mb-md flex items-center gap-sm text-heading3 font-sans font-bold text-text-primary"
                          >
                            <Star size={18} className="text-text-muted" aria-hidden="true" />
                            {categoryLabel}
                          </h3>

                          {doneWell.length > 0 && (
                            <div className="mb-md">
                              <h4 className="mb-sm text-bodySmall font-sans font-semibold text-text-primary">
                                What&apos;s Done Well
                              </h4>
                              <ul className="flex flex-col gap-xs pl-md">
                                {doneWell.map((item) => (
                                  <li
                                    key={item.id}
                                    className="flex flex-col gap-xs text-bodySmall text-text-primary"
                                  >
                                    <div className="flex items-start gap-sm">
                                      <span className="mt-[3px] text-signal-positive">&#x2714;</span>
                                      <span>{item.questionText}</span>
                                    </div>
                                    {item.quotedText && (
                                      <blockquote
                                        className={`ml-sm border-l-2 pl-md italic cursor-pointer rounded px-sm transition-colors break-words ${
                                          activeQuoteId === item.id
                                            ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                                            : 'border-signal-positive/30 text-text-secondary hover:bg-signal-positive/5 hover:border-signal-positive/60'
                                        }`}
                                        onClick={() =>
                                          onQuoteClick?.({
                                            feedbackItemId: item.id,
                                            anchorId: item.currentAnchorId,
                                            quotedText: item.quotedText,
                                            resolvedHighlight: item.resolvedHighlight ?? undefined,
                                          })
                                        }
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={activeQuoteId === item.id}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onQuoteClick?.({
                                              feedbackItemId: item.id,
                                              anchorId: item.currentAnchorId,
                                              quotedText: item.quotedText,
                                            });
                                          }
                                        }}
                                      >
                                        &quot;{item.quotedText}&quot;
                                      </blockquote>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {improvements.length > 0 && (
                            <div>
                              <h4 className="mb-sm text-bodySmall font-sans font-semibold text-text-primary">
                                Areas for Improvement
                              </h4>
                              <ul className="flex flex-col gap-xs pl-md">
                                {improvements.map((item) => (
                                  <li
                                    key={item.id}
                                    className="flex flex-col gap-xs text-bodySmall text-text-primary"
                                  >
                                    <div className="flex items-start gap-sm">
                                      <span className="mt-[3px] text-signal-critical">&#x2022;</span>
                                      <span>{item.questionText}</span>
                                    </div>
                                    {item.quotedText && (
                                      <blockquote
                                        className={`ml-sm border-l-2 pl-md italic cursor-pointer rounded px-sm transition-colors break-words ${
                                          activeQuoteId === item.id
                                            ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                                            : 'border-signal-critical/30 text-text-secondary hover:bg-signal-critical/5 hover:border-signal-critical/60'
                                        }`}
                                        onClick={() =>
                                          onQuoteClick?.({
                                            feedbackItemId: item.id,
                                            anchorId: item.currentAnchorId,
                                            quotedText: item.quotedText,
                                            resolvedHighlight: item.resolvedHighlight ?? undefined,
                                          })
                                        }
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={activeQuoteId === item.id}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onQuoteClick?.({
                                              feedbackItemId: item.id,
                                              anchorId: item.currentAnchorId,
                                              quotedText: item.quotedText,
                                            });
                                          }
                                        }}
                                      >
                                        &quot;{item.quotedText}&quot;
                                      </blockquote>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </section>
                      );
                    })}

                    <FeedbackHelpfulnessPrompt
                      environmentId={environmentId}
                      draftId={debrief.draftId}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Fixed footer */}
          <div className="flex items-center border-t border-border-subtle px-xl py-md">
            <span className="text-caption text-text-muted">
              {debrief ? `Based on draft ${debrief.draftId}` : ' '}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
