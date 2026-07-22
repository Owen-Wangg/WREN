/**
 * `<SidebarDebriefPanel>` — AI Debrief as a sidebar panel (not a floating modal).
 * Extracted from AiDebriefModal, with modal styling removed and regenerate
 * button added to the content header.
 *
 * Same compliance requirements as AiDebriefModal:
 *  - No-ghostwriting: no Apply/Insert/Accept affordance (feedback only)
 *  - Draft-anchored to specific draftId
 *  - Inline vs. structural feedback separated (Requirement 14.2)
 */
import { ArrowUp, Minus, Star, TrendingUp } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { AiDisclaimerNotice } from '@/components/ui';

import { FeedbackHelpfulnessPrompt } from './FeedbackHelpfulnessPrompt';
import { CitationDisplay } from './CitationDisplay';

import { useAiDebrief, useRegenerateDebrief } from '../useDebrief';

import type { ProgressPattern } from '../debriefTypes';
import type { FeedbackItem } from '@wren/types';

const DEBRIEF_DISCLAIMER_MESSAGE =
  'The following content is AI generated and should be considered as suggestions. This system will always provide feedback, and it may not always be applicable, so please use your judgement when considering this feedback. If you have questions about the feedback provided to you in this debrief, please reach out to a field expert or admin user.';

export interface SidebarDebriefPanelProps {
  readonly environmentId: string;
  readonly autoRegenerate?: boolean;
  /** True while DocumentEditorPage is polling for feedback generation. */
  readonly isGenerating?: boolean;
  /** Called when student clicks a quoted text to highlight it in the document. */
  readonly onQuoteClick?: (anchorId: string | undefined) => void;
}

export function SidebarDebriefPanel({
  environmentId,
  autoRegenerate = false,
  isGenerating = false,
  onQuoteClick,
}: SidebarDebriefPanelProps) {
  const debriefQuery = useAiDebrief(environmentId);
  const regenerate = useRegenerateDebrief(environmentId);

  const didAutoRegenerate = useRef(false);
  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;

  useEffect(() => {
    if (autoRegenerate && !didAutoRegenerate.current) {
      didAutoRegenerate.current = true;
      regenerateRef.current.mutate();
    }
    return () => {
      didAutoRegenerate.current = false;
    };
  }, [autoRegenerate]);

  const debrief = debriefQuery.data;

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
    <div className="flex h-full flex-col">
      {/* Header with regenerate button */}
      <div className="flex items-center justify-between border-b border-border-subtle px-lg py-md">
        <div>
          <h3 className="text-heading3 font-sans font-semibold text-text-primary">
            AI Debrief
          </h3>
          {debrief?.progressSummary && debrief.progressSummary.length > 0 && (
            <p className="text-bodySmall text-text-secondary">
              Feedback & your progress
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending || debriefQuery.isLoading}
          className="rounded-md px-sm py-xs text-body font-sans font-semibold text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Regenerate AI Debrief"
        >
          {regenerate.isPending ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-accent-primary" />
          ) : (
            '↻ Regenerate'
          )}
        </button>
      </div>

      {/* Scrollable content area */}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-lg py-md">
        <AiDisclaimerNotice
          dismissible
          dismissStorageKey="ai-debrief-disclaimer-dismissed"
          message={DEBRIEF_DISCLAIMER_MESSAGE}
          className="mb-lg text-caption leading-relaxed"
        />

        {(debriefQuery.isLoading || (isGenerating && !debrief)) && (
          <div className="flex flex-col items-center gap-md py-xl text-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-strong border-t-accent-primary" />
            <p role="status" className="text-body text-text-secondary">
              {isGenerating ? 'Generating feedback…' : 'Loading AI Debrief…'}
            </p>
            {isGenerating && (
              <p className="text-bodySmall text-text-muted">This usually takes 20–40 seconds.</p>
            )}
          </div>
        )}

        {debriefQuery.isError && (
          <div role="alert" className="flex flex-col gap-sm">
            <p className="text-body text-signal-critical">
              Something went wrong loading the AI Debrief.
            </p>
            <button
              type="button"
              onClick={() => debriefQuery.refetch()}
              className="self-start rounded-md border border-border-strong px-md py-xs text-body font-sans font-medium text-text-primary"
            >
              Retry
            </button>
          </div>
        )}

        {regenerate.isError && (
          <p role="alert" className="mb-md text-body text-signal-critical">
            Couldn't regenerate. Please try again.
          </p>
        )}

        {debrief && !debriefQuery.isLoading && !debriefQuery.isError && (
          <>
            {debrief.items.length === 0 ? (
              <div className="flex flex-col items-center gap-md py-xl text-center">
                {isGenerating || regenerate.isPending ? (
                  <>
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-strong border-t-accent-primary" />
                    <p className="text-body text-text-secondary">Generating feedback…</p>
                    <p className="text-bodySmall text-text-muted">This usually takes 20–40 seconds.</p>
                  </>
                ) : (
                  <p className="text-body text-text-secondary">
                    No feedback yet. Click <strong>Generate Feedback</strong> to get started.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-lg">
                {/* Progress Summary Card */}
                {debrief.progressSummary && debrief.progressSummary.length > 0 && (
                  <section aria-labelledby="progress-card-heading">
                    <div className="mb-md rounded-lg border border-accent-primary/20 bg-accent-primary/5 p-md">
                      <h3 id="progress-card-heading" className="mb-md flex items-center gap-sm text-body font-sans font-semibold text-text-primary">
                        <TrendingUp size={16} className="text-signal-positive" aria-hidden="true" />
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
                              <div className="flex items-center gap-md text-bodySmall">
                                <div className="flex items-center gap-xs">
                                  <ArrowUp size={14} className="text-signal-positive" aria-hidden="true" />
                                  <span className="font-semibold text-text-primary">{improving} Improving</span>
                                </div>
                                <span className="text-text-muted">|</span>
                                <div className="flex items-center gap-xs">
                                  <Minus size={14} className="text-signal-caution" aria-hidden="true" />
                                  <span className="font-semibold text-text-primary">{persistent} Persistent</span>
                                </div>
                                <span className="text-text-muted">|</span>
                                <div className="flex items-center gap-xs">
                                  <Star size={14} className="text-accent-primary" aria-hidden="true" />
                                  <span className="font-semibold text-text-primary">{emerging} Emerging</span>
                                </div>
                              </div>
                              {topImprovement && (
                                <p className="text-bodySmall font-medium text-signal-positive">
                                  Keep the momentum on "{topImprovement.category}"
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="flex flex-col gap-md">
                      {debrief.progressSummary.map((pattern: ProgressPattern) => (
                        <div
                          key={pattern.category}
                          className="flex items-start gap-md rounded-md border border-border-subtle bg-surface-muted/30 p-md"
                        >
                          <div className="mt-[2px] shrink-0">
                            {pattern.tendency === 'improving' && (
                              <ArrowUp size={14} className="text-signal-positive" aria-hidden="true" />
                            )}
                            {pattern.tendency === 'persistent' && (
                              <Minus size={14} className="text-signal-caution" aria-hidden="true" />
                            )}
                            {pattern.tendency === 'emerging' && (
                              <Star size={14} className="text-accent-primary" aria-hidden="true" />
                            )}
                          </div>
                          <div className="flex flex-col gap-xs">
                            <div className="flex items-center gap-sm">
                              <span className="text-bodySmall font-semibold text-text-primary">
                                {pattern.category}
                              </span>
                              <span className={`rounded-full px-xs py-[1px] text-bodySmall font-sans font-medium ${
                                pattern.tendency === 'improving'
                                  ? 'bg-signal-positive/10 text-signal-positive'
                                  : pattern.tendency === 'persistent'
                                    ? 'bg-signal-caution/10 text-signal-caution'
                                    : 'bg-accent-primary/10 text-accent-primary'
                              }`}>
                                {pattern.tendency}
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
                      <h4
                        id={`ai-debrief-category-${category}`}
                        className="mb-md flex items-center gap-xs text-heading4 font-sans font-bold text-text-primary"
                      >
                        <Star size={16} className="text-text-muted" aria-hidden="true" />
                        {categoryLabel}
                      </h4>

                      {doneWell.length > 0 && (
                        <div className="mb-md">
                          <h5 className="mb-xs text-bodySmall font-semibold text-text-primary">
                            What&apos;s Done Well
                          </h5>
                          <ul className="flex flex-col gap-xs pl-md">
                            {doneWell.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-col gap-xs text-bodySmall text-text-primary"
                              >
                                <div className="flex items-start gap-sm">
                                  <span className="mt-[2px] text-signal-positive">✓</span>
                                  <span>{item.questionText}</span>
                                </div>
                                {item.quotedText && (
                                  <blockquote
                                    className="ml-sm border-l-2 border-signal-positive/30 pl-md italic text-bodySmall text-text-secondary cursor-pointer hover:bg-signal-positive/5 hover:border-signal-positive/60 rounded px-sm transition-colors"
                                    onClick={() => onQuoteClick?.(item.currentAnchorId)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        onQuoteClick?.(item.currentAnchorId);
                                      }
                                    }}
                                  >
                                    &quot;{item.quotedText}&quot;
                                  </blockquote>
                                )}
                                <CitationDisplay citationReferenceId={item.citationReferenceId} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {improvements.length > 0 && (
                        <div>
                          <h5 className="mb-xs text-bodySmall font-semibold text-text-primary">
                            Areas for Improvement
                          </h5>
                          <ul className="flex flex-col gap-xs pl-md">
                            {improvements.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-col gap-xs text-bodySmall text-text-primary"
                              >
                                <div className="flex items-start gap-sm">
                                  <span className="mt-[2px] text-signal-critical">•</span>
                                  <span>{item.questionText}</span>
                                </div>
                                {item.quotedText && (
                                  <blockquote
                                    className="ml-sm border-l-2 border-signal-critical/30 pl-md italic text-bodySmall text-text-secondary cursor-pointer hover:bg-signal-critical/5 hover:border-signal-critical/60 rounded px-sm transition-colors"
                                    onClick={() => onQuoteClick?.(item.currentAnchorId)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        onQuoteClick?.(item.currentAnchorId);
                                      }
                                    }}
                                  >
                                    &quot;{item.quotedText}&quot;
                                  </blockquote>
                                )}
                                <CitationDisplay citationReferenceId={item.citationReferenceId} />
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
    </div>
  );
}
