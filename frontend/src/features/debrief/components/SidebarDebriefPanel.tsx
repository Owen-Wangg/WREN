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
import { ArrowUp, CheckCircle2, ChevronDown, Minus, Star, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AiDisclaimerNotice } from '@/components/ui';
import { useDocuments, useOrganizations, useWritingTypes } from '@/features/dashboard/useDashboard';

import { FeedbackHelpfulnessPrompt } from './FeedbackHelpfulnessPrompt';
import { CitationDisplay } from './CitationDisplay';
import { SectionApplicabilityToggle } from './SectionApplicabilityToggle';

import { isStrengthItem, strengthDisplayText } from '../debriefItems';
import { useAiDebrief, useDebriefHistory, useRegenerateDebrief, useSectionApplicability } from '../useDebrief';
import { useDebriefSubscription } from '../useDebriefSubscription';

import type { ProgressPattern } from '../debriefTypes';
import type { FeedbackItem } from '@wren/types';

function buildDebriefDisclaimer(departmentName?: string): string {
  const expert = departmentName
    ? `an expert in ${departmentName}`
    : 'an expert in your department';
  return `The following content is AI generated and should be considered as suggestions. This system will always provide feedback, and it may not always be applicable, so please use your judgement when considering this feedback. If you have questions about the feedback provided to you in this debrief, please reach out to ${expert}.`;
}

const GENERATING_STEPS: Array<{ message: string; detail: string }> = [
  {
    message: 'Reading your draft…',
    detail: 'Scanning your submission for patterns and structure.',
  },
  {
    message: 'Analysing your writing…',
    detail: 'Identifying areas of strength and opportunities to improve.',
  },
  {
    message: 'Building your feedback…',
    detail: 'Crafting specific, Socratic questions for each finding.',
  },
  {
    message: 'Finalising your debrief…',
    detail: 'Almost ready — this usually takes 20–40 seconds in total.',
  },
];

function formatDebriefTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCompactGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function useGeneratingStep(active: boolean): { message: string; detail: string; stepIndex: number } {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    setIndex(0);
    const id = setInterval(() => {
      setIndex((i) => Math.min(i + 1, GENERATING_STEPS.length - 1));
    }, 8000);
    return () => clearInterval(id);
  }, [active]);
  return { ...(GENERATING_STEPS[index] ?? GENERATING_STEPS[0]!), stepIndex: index };
}

function DebriefSkeleton() {
  return (
    <div className="flex flex-col gap-lg animate-pulse" aria-hidden="true">
      {/* Progress card placeholder */}
      <div className="rounded-lg border border-border-subtle bg-surface-muted/40 p-md">
        <div className="mb-md h-4 w-40 rounded bg-border-subtle" />
        <div className="flex gap-md">
          <div className="h-3 w-20 rounded bg-border-subtle" />
          <div className="h-3 w-20 rounded bg-border-subtle" />
          <div className="h-3 w-20 rounded bg-border-subtle" />
        </div>
      </div>
      {/* Category section placeholders */}
      {[1, 2, 3].map((n) => (
        <div key={n} className="flex flex-col gap-sm">
          <div className="h-4 w-32 rounded bg-border-subtle" />
          <div className="h-3 w-full rounded bg-border-subtle/60" />
          <div className="h-3 w-5/6 rounded bg-border-subtle/60" />
          <div className="h-3 w-4/6 rounded bg-border-subtle/60" />
        </div>
      ))}
    </div>
  );
}

export interface SidebarDebriefPanelProps {
  readonly environmentId: string;
  readonly autoRegenerate?: boolean;
  /** True while DocumentEditorPage is polling for feedback generation. */
  readonly isGenerating?: boolean;
  /**
   * False while the document/draft is still loading or being ingested.
   * Prevents premature fetches and disables Regenerate until ready.
   */
  readonly isDocumentReady?: boolean;
  /**
   * Persist in-editor edits as a new draft before feedback runs.
   * TipTap content stays the source of truth in DocumentEditorPage.
   */
  readonly onBeforeRegenerate?: () => Promise<void>;
  /** Feedback item id of the quote currently highlighted in the editor. */
  readonly activeQuoteId?: string;
  /** Called when student clicks a quoted text to highlight it in the document. */
  readonly onQuoteClick?: (selection: {
    feedbackItemId: string;
    anchorId?: string;
    quotedText?: string;
  }) => void;
}

export function SidebarDebriefPanel({
  environmentId,
  autoRegenerate = false,
  isGenerating = false,
  isDocumentReady = true,
  onBeforeRegenerate,
  activeQuoteId,
  onQuoteClick,
}: SidebarDebriefPanelProps) {
  const { data: documents } = useDocuments();
  const { data: writingTypes } = useWritingTypes();
  const { data: organizations } = useOrganizations();

  const currentDoc = documents?.find((d) => d.id === environmentId);
  const writingType = writingTypes?.find((wt) => wt.id === currentDoc?.documentTypeId);
  const organization = organizations?.find((org) => org.id === writingType?.organizationId);
  const departmentName = organization?.name;

  /** null = latest generation; otherwise a historical draft's debrief */
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  const historyQuery = useDebriefHistory(environmentId);
  const regenerate = useRegenerateDebrief(environmentId);
  const [isSavingThenRegen, setIsSavingThenRegen] = useState(false);
  // True from when the 202 lands until the AppSync onDebriefReady event fires.
  const [isAwaitingDebrief, setIsAwaitingDebrief] = useState(false);

  // Use history's most recent draftId as the source of truth when no explicit
  // selection has been made. This bypasses the backend's "latest by
  // version_number" resolution which may point to an autosaved draft with 0
  // items. Wait for history to settle before enabling the debrief query so we
  // don't fire with draftId=null and get a stale error that persists.
  const historySettled = historyQuery.isSuccess || historyQuery.isError;
  const effectiveDraftId =
    selectedDraftId ?? (historyQuery.data?.[0]?.draftId || null);
  const debriefEnabled = isDocumentReady && (historySettled || !!selectedDraftId);
  const debriefQuery = useAiDebrief(environmentId, effectiveDraftId, debriefEnabled);
  const activeDraftId = debriefQuery.data?.draftId ?? effectiveDraftId;
  const applicabilityQuery = useSectionApplicability(environmentId, activeDraftId);

  useDebriefSubscription(
    environmentId,
    isAwaitingDebrief,
    () => setIsAwaitingDebrief(false),
  );

  const didAutoRegenerate = useRef(false);
  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;
  const onBeforeRegenerateRef = useRef(onBeforeRegenerate);
  onBeforeRegenerateRef.current = onBeforeRegenerate;

  const runRegenerate = async () => {
    setIsSavingThenRegen(true);
    setIsAwaitingDebrief(false);
    setHistoryOpen(false);
    try {
      await onBeforeRegenerateRef.current?.();
      await regenerateRef.current.mutateAsync();
      // POST returned 202 — hand off the "waiting" flag to the subscription.
      setSelectedDraftId(null);
      setIsAwaitingDebrief(true);
    } catch {
      // Error surfaces via regenerate.isError; keep panel usable.
    } finally {
      setIsSavingThenRegen(false);
    }
  };

  useEffect(() => {
    if (autoRegenerate && !didAutoRegenerate.current) {
      didAutoRegenerate.current = true;
      void runRegenerate();
    }
    return () => {
      didAutoRegenerate.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per autoRegenerate mount
  }, [autoRegenerate]);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        historyMenuRef.current &&
        !historyMenuRef.current.contains(event.target as Node)
      ) {
        setHistoryOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [historyOpen]);

  const debrief = debriefQuery.data;
  const regenerating = isSavingThenRegen || regenerate.isPending || isAwaitingDebrief;

  const generatingStep = useGeneratingStep(regenerating);
  const hasFeedback = (debrief?.items.length ?? 0) > 0;
  // Subsequent regenerates keep existing feedback on screen — show dots on the
  // button so it's obvious a new debrief is in flight.
  const showRegenDots = (regenerating || isGenerating) && hasFeedback;
  const viewingHistorical = selectedDraftId != null;
  const lastGeneratedCompact =
    hasFeedback && debrief?.generatedAt
      ? formatCompactGeneratedAt(debrief.generatedAt)
      : null;

  // Prefer API history; if it isn't available yet, fall back to the loaded debrief
  // so the title still exposes a version menu whenever feedback exists.
  const historyVersions =
    historyQuery.data && historyQuery.data.length > 0
      ? historyQuery.data
      : hasFeedback && debrief?.draftId && debrief.draftId !== 'none'
        ? [
            {
              draftId: debrief.draftId,
              draftVersion: 1,
              generatedAt: debrief.generatedAt,
              itemCount: debrief.items.length,
            },
          ]
        : [];
  const canOpenHistory = hasFeedback || historyVersions.length > 0;

  // Group all items by category; within each category separate strengths from questions.
  const allItems = debrief?.items ?? [];
  const categoryOrder: string[] = [];
  const strengthsByCategory: Record<string, FeedbackItem[]> = {};
  const improvementsByCategory: Record<string, FeedbackItem[]> = {};
  for (const item of allItems) {
    const cat = item.errorCategoryId;
    if (!categoryOrder.includes(cat)) categoryOrder.push(cat);
    if (isStrengthItem(item)) {
      if (!strengthsByCategory[cat]) strengthsByCategory[cat] = [];
      strengthsByCategory[cat].push(item);
    } else {
      if (!improvementsByCategory[cat]) improvementsByCategory[cat] = [];
      improvementsByCategory[cat].push(item);
    }
  }

  const selectHistoryVersion = (draftId: string, isLatest: boolean) => {
    setSelectedDraftId(isLatest ? null : draftId);
    setHistoryOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header: title left, regenerate + timestamp stacked right */}
      <div className="flex items-start justify-between gap-md border-b border-border-subtle px-lg py-md">
        <div className="relative min-w-0" ref={historyMenuRef}>
          <button
            type="button"
            className={`flex items-center gap-xs rounded-md text-left transition-colors ${
              canOpenHistory
                ? 'hover:bg-surface-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40'
                : 'cursor-default'
            }`}
            aria-haspopup={canOpenHistory ? 'listbox' : undefined}
            aria-expanded={canOpenHistory ? historyOpen : undefined}
            aria-label={
              canOpenHistory
                ? 'AI Debrief version history'
                : 'AI Debrief'
            }
            disabled={!canOpenHistory}
            onClick={() => {
              if (canOpenHistory) setHistoryOpen((open) => !open);
            }}
          >
            <span className="text-heading3 font-sans font-semibold text-text-primary">
              AI Debrief
            </span>
            {canOpenHistory && (
              <ChevronDown
                size={16}
                className={`shrink-0 text-text-muted transition-transform ${
                  historyOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            )}
          </button>
          {viewingHistorical ? (
            <p className="mt-xs text-caption text-text-secondary whitespace-nowrap">
              Viewing earlier debrief
            </p>
          ) : (
            debrief?.progressSummary &&
            debrief.progressSummary.length > 0 && (
              <p className="mt-xs text-caption text-text-secondary whitespace-nowrap">
                Feedback & your progress
              </p>
            )
          )}
          {historyOpen && canOpenHistory && (
            <ul
              role="listbox"
              aria-label="Previous AI Debriefs"
              className="absolute left-0 top-full z-20 mt-xs max-h-64 min-w-[16rem] overflow-y-auto rounded-md border border-border-subtle bg-surface-primary py-xs shadow-md"
            >
              {historyQuery.isLoading && (
                <li className="px-md py-sm text-caption text-text-muted">
                  Loading history…
                </li>
              )}
              {historyQuery.isError && historyVersions.length <= 1 && (
                <li className="px-md py-sm text-caption text-text-muted">
                  Previous versions unavailable right now.
                </li>
              )}
              {historyVersions.map((version, index) => {
                const isLatest = index === 0;
                const isSelected = selectedDraftId
                  ? selectedDraftId === version.draftId
                  : isLatest;
                const when = formatDebriefTimestamp(version.generatedAt);
                return (
                  <li key={version.draftId} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={`flex w-full flex-col items-start gap-xs px-md py-sm text-left transition-colors ${
                        isSelected
                          ? 'bg-accent-primary/10 text-accent-primary'
                          : 'text-text-primary hover:bg-surface-muted/60'
                      }`}
                      onClick={() => selectHistoryVersion(version.draftId, isLatest)}
                    >
                      <span className="text-bodySmall font-semibold">
                        {isLatest ? 'Latest' : `Draft ${version.draftVersion}`}
                        {isLatest ? ` · Draft ${version.draftVersion}` : ''}
                      </span>
                      <span className="text-caption text-text-muted">
                        {when}
                        {version.itemCount > 0
                          ? ` · ${version.itemCount} item${version.itemCount === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-xs">
          <button
            type="button"
            onClick={() => void runRegenerate()}
            disabled={regenerating || isGenerating || debriefQuery.isLoading || !isDocumentReady}
            className={`inline-flex min-w-[7.25rem] items-center justify-center rounded-md px-sm py-xs text-body font-sans font-semibold text-accent-primary hover:bg-accent-primary/10 disabled:cursor-not-allowed transition-colors ${
              showRegenDots ? '' : 'disabled:opacity-50'
            }`}
            aria-label={
              showRegenDots ? 'Regenerating AI Debrief' : 'Regenerate AI Debrief'
            }
            aria-busy={showRegenDots}
          >
            {showRegenDots ? (
              <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-[6px] w-[6px] rounded-full bg-accent-primary"
                    style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                  />
                ))}
              </span>
            ) : (
              '↻ Regenerate'
            )}
          </button>
          {!regenerating && !showRegenDots && (
            <span className="px-sm text-caption text-text-muted whitespace-nowrap text-right leading-tight">
              Saves inline edits &amp;<br />regenerates feedback
            </span>
          )}
          {lastGeneratedCompact && (
            <span
              className="px-sm text-caption text-text-muted whitespace-nowrap"
              title={
                debrief?.generatedAt
                  ? `Last generated ${formatDebriefTimestamp(debrief.generatedAt)}`
                  : undefined
              }
            >
              {lastGeneratedCompact}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-lg py-md">
        <AiDisclaimerNotice
          dismissible
          dismissStorageKey="ai-debrief-disclaimer-dismissed"
          dismissScopeId={environmentId}
          message={buildDebriefDisclaimer(departmentName)}
          className="mb-lg text-caption leading-relaxed"
        />

        {!isDocumentReady && (
          <div className="flex flex-col items-center gap-md py-xl text-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-accent-primary" />
            <p className="text-bodySmall text-text-secondary">
              Preparing your document… feedback will be available once it's ready.
            </p>
          </div>
        )}

        {isDocumentReady && debriefQuery.isLoading && !isGenerating && !regenerating && <DebriefSkeleton />}

        {isDocumentReady && isGenerating && !debrief && (
          <div className="flex flex-col gap-lg py-xl">
            {/* Step indicator */}
            <div className="flex items-center gap-xs">
              {GENERATING_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-full transition-colors duration-500 ${
                    i <= generatingStep.stepIndex
                      ? 'bg-accent-primary animate-pulse'
                      : 'bg-border-subtle'
                  }`}
                />
              ))}
            </div>
            <div className="flex flex-col gap-sm rounded-lg border border-accent-primary/20 bg-accent-primary/5 p-md">
              <p role="status" className="text-body font-semibold text-text-primary">
                {generatingStep.message}
              </p>
              <p className="text-bodySmall text-text-secondary leading-relaxed">
                {generatingStep.detail}
              </p>
              <p className="text-caption text-text-muted">
                Please don&apos;t close or refresh this page.
              </p>
            </div>
          </div>
        )}

        {isDocumentReady && debriefQuery.isError && !regenerating && !isGenerating && (
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

        {isDocumentReady && debrief && !debriefQuery.isLoading && !debriefQuery.isError && (
          <>
            {debrief.items.length === 0 ? (
              <div className="flex flex-col items-center gap-md py-xl text-center">
                {isGenerating || regenerating ? (
                  <div className="flex w-full flex-col gap-lg py-xl">
                    <div className="flex items-center gap-xs">
                      {GENERATING_STEPS.map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
                            i <= generatingStep.stepIndex
                              ? 'bg-accent-primary'
                              : 'bg-border-subtle'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex flex-col gap-sm">
                      <p role="status" className="text-body font-medium text-text-primary">
                        {generatingStep.message}
                      </p>
                      <p className="text-bodySmall text-text-secondary leading-relaxed">
                        {generatingStep.detail}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-body text-text-secondary">
                    No feedback yet. Click <strong>Regenerate</strong> to save your draft and generate feedback.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-lg">
                {/* Progress Summary Card — only for the latest debrief */}
                {!viewingHistorical && debrief.progressSummary && debrief.progressSummary.length > 0 && (
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
                          const nearlyResolved = debrief.progressSummary.filter(p => p.tendency === 'nearly_resolved').length;
                          const emerging = debrief.progressSummary.filter(p => p.tendency === 'emerging').length;
                          const topImprovement = debrief.progressSummary.find(p => p.tendency === 'improving');

                          return (
                            <>
                              <div className="flex flex-wrap items-center gap-x-md gap-y-xs text-bodySmall">
                                {improving > 0 && (
                                  <>
                                    <div className="flex items-center gap-xs whitespace-nowrap">
                                      <ArrowUp size={14} className="shrink-0 text-signal-positive" aria-hidden="true" />
                                      <span className="font-semibold text-text-primary">{improving} Improving</span>
                                    </div>
                                    <span className="text-text-muted" aria-hidden="true">|</span>
                                  </>
                                )}
                                {persistent > 0 && (
                                  <>
                                    <div className="flex items-center gap-xs whitespace-nowrap">
                                      <Minus size={14} className="shrink-0 text-signal-caution" aria-hidden="true" />
                                      <span className="font-semibold text-text-primary">{persistent} Persistent</span>
                                    </div>
                                    <span className="text-text-muted" aria-hidden="true">|</span>
                                  </>
                                )}
                                {nearlyResolved > 0 && (
                                  <>
                                    <div className="flex items-center gap-xs whitespace-nowrap">
                                      <CheckCircle2 size={14} className="shrink-0 text-signal-positive" aria-hidden="true" />
                                      <span className="font-semibold text-text-primary">{nearlyResolved} Nearly there</span>
                                    </div>
                                    <span className="text-text-muted" aria-hidden="true">|</span>
                                  </>
                                )}
                                {emerging > 0 && (
                                  <div className="flex items-center gap-xs whitespace-nowrap">
                                    <Star size={14} className="shrink-0 text-accent-primary" aria-hidden="true" />
                                    <span className="font-semibold text-text-primary">{emerging} Emerging</span>
                                  </div>
                                )}
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
                            {pattern.tendency === 'nearly_resolved' && (
                              <CheckCircle2 size={14} className="text-signal-positive" aria-hidden="true" />
                            )}
                            {pattern.tendency === 'emerging' && (
                              <Star size={14} className="text-accent-primary" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 flex flex-col gap-xs">
                            <div className="flex flex-wrap items-center gap-sm">
                              <span className="text-bodySmall font-semibold text-text-primary break-words">
                                {pattern.category}
                              </span>
                              <span className={`shrink-0 rounded-full px-xs py-[1px] text-bodySmall font-sans font-medium ${
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
                            <p className="text-bodySmall leading-relaxed text-text-secondary break-words">
                              {pattern.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ── Per-category sections ── */}
                {categoryOrder.map((category) => {
                  const strengths = strengthsByCategory[category] ?? [];
                  const improvements = improvementsByCategory[category] ?? [];
                  if (strengths.length === 0 && improvements.length === 0) return null;
                  const categoryLabel = debrief.categoryNames?.[category] ?? category;

                  return (
                    <section
                      key={category}
                      aria-labelledby={`debrief-cat-${category}`}
                      className="flex flex-col gap-md"
                    >
                      {/* Category heading */}
                      <h4
                        id={`debrief-cat-${category}`}
                        className="flex items-center justify-between gap-xs text-heading4 font-sans font-bold text-text-primary border-b border-border-subtle pb-xs"
                      >
                        <span>{categoryLabel}</span>
                        {activeDraftId && (
                          <SectionApplicabilityToggle
                            environmentId={environmentId}
                            draftId={activeDraftId}
                            errorCategoryId={category}
                            initialVote={applicabilityQuery.data?.votes[category]}
                          />
                        )}
                      </h4>

                      {/* What's Done Well — affirmations only, zero questions */}
                      {strengths.length > 0 && (
                        <div>
                          <h5 className="mb-sm text-caption font-semibold uppercase tracking-wide text-signal-positive">
                            What&apos;s Done Well
                          </h5>
                          <ul className="flex flex-col gap-sm">
                            {strengths.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-col gap-xs rounded-md bg-signal-positive/5 px-sm py-xs"
                              >
                                <div className="flex items-start gap-sm">
                                  <span className="mt-[2px] shrink-0 text-signal-positive">✓</span>
                                  <span className="text-bodySmall text-text-primary">
                                    {strengthDisplayText(item)}
                                  </span>
                                </div>
                                {item.quotedText && (
                                  <div className="flex flex-col gap-[2px] pl-[20px]">
                                    <span className="text-caption text-signal-positive/70 uppercase tracking-wide font-medium">
                                      Where you did this well
                                    </span>
                                    <blockquote
                                      className={`border-l-2 pl-md text-bodySmall italic cursor-pointer rounded-r-sm px-sm py-xs transition-colors break-words ${
                                        activeQuoteId === item.id
                                          ? 'border-signal-positive bg-signal-positive/10 text-text-primary'
                                          : 'border-signal-positive/50 text-text-secondary hover:bg-signal-positive/10 hover:border-signal-positive'
                                      }`}
                                      onClick={() =>
                                        onQuoteClick?.({
                                          feedbackItemId: item.id,
                                          anchorId: item.currentAnchorId,
                                          quotedText: item.quotedText,
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
                                      &ldquo;{item.quotedText}&rdquo;
                                    </blockquote>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Areas for Improvement — questions first, quote as supporting evidence */}
                      {improvements.length > 0 && (
                        <div>
                          <h5 className="mb-sm text-caption font-semibold uppercase tracking-wide text-signal-caution">
                            Areas for Improvement
                          </h5>
                          <ul className="flex flex-col gap-md">
                            {improvements.map((item) => (
                              <li key={item.id} className="flex flex-col gap-xs">
                                {/* Question is the unavoidable headline */}
                                <p className="text-bodySmall font-medium text-text-primary">
                                  {item.questionText}
                                </p>
                                {/* Quote is one example of the pattern — label makes clear there may be more */}
                                {item.quotedText && (
                                  <div className="flex flex-col gap-[2px]">
                                    <span className="text-caption text-signal-caution/80 uppercase tracking-wide font-medium">
                                      One example — check your whole draft for this
                                    </span>
                                    <blockquote
                                      className={`border-l-2 pl-md text-bodySmall italic cursor-pointer rounded-r-sm px-sm py-xs transition-colors break-words ${
                                        activeQuoteId === item.id
                                          ? 'border-signal-caution bg-signal-caution/10 text-text-primary'
                                          : 'border-signal-caution/40 text-text-secondary hover:bg-signal-caution/10 hover:border-signal-caution'
                                      }`}
                                      onClick={() =>
                                        onQuoteClick?.({
                                          feedbackItemId: item.id,
                                          anchorId: item.currentAnchorId,
                                          quotedText: item.quotedText,
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
                                      &ldquo;{item.quotedText}&rdquo;
                                    </blockquote>
                                  </div>
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
