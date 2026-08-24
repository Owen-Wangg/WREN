/**
 * `<ChatFeedbackSidebar>` — Ask LEON + AI Debrief panels for the document
 * editor left content area. Navigation is owned by the page icon rail;
 * this component only renders the selected panel (both stay mounted so
 * Ask chat history survives mode switches).
 */
import { useMemo } from 'react';

import { WrenChatPanel, type AskWrenService } from '@/features/ask-wren';
import { SidebarDebriefPanel, useAiDebrief } from '@/features/debrief';

export type DocumentNavMode = 'home' | 'chat' | 'debrief';

export interface ChatFeedbackSidebarProps {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  /** Which coach panel to show (`home` hides both; they stay mounted). */
  readonly activeMode: DocumentNavMode;
  /** Live word count from the editor (preferred) or latest draft. */
  readonly wordCount?: number;
  readonly askWrenService: AskWrenService;
  readonly isGeneratingFeedback?: boolean;
  /** True after the first few minutes while the job is still running. */
  readonly isTakingLonger?: boolean;
  /** False while the document/draft is still loading or being ingested. */
  readonly isDocumentReady?: boolean;
  /** Persist editor content as a new draft before AI Debrief regenerate. */
  readonly onBeforeRegenerate?: () => Promise<void>;
  /** Start the page-level feedback status poll after the job is queued. */
  readonly onFeedbackQueued?: () => void;
  /** Called when generation fails without producing items. */
  readonly onGenerationFailed?: () => void;
  /** Shown when polling times out or the generation job fails. */
  readonly generationError?: string;
  readonly onHighlight?: (anchorId: string) => void;
  /** Called when the student clicks a quoted phrase in Ask LEON chat. */
  readonly onChatQuoteClick?: (selection: {
    quotedText: string;
    locationHint?: string;
    quoteKey: string;
  }) => void;
  /** @deprecated Prefer `onChatQuoteClick`. */
  readonly onHighlightText?: (text: string) => void;
  /** Feedback item / chat quote id currently highlighted in the editor. */
  readonly activeQuoteId?: string;
  /** True when the editor could not resolve the highlighted quote to an exact span. */
  readonly highlightFailed?: boolean;
  readonly onQuoteClick?: (selection: {
    feedbackItemId: string;
    anchorId?: string;
    quotedText?: string;
    resolvedHighlight?: { paragraphIndex: number; startOffset: number; endOffset: number };
  }) => void;
}

export function ChatFeedbackSidebar({
  documentId,
  draftId,
  draftVersion,
  activeMode,
  wordCount = 0,
  askWrenService,
  isGeneratingFeedback = false,
  isTakingLonger = false,
  isDocumentReady = true,
  onBeforeRegenerate,
  onFeedbackQueued,
  onGenerationFailed,
  generationError,
  onHighlight,
  onChatQuoteClick,
  onHighlightText,
  activeQuoteId,
  highlightFailed,
  onQuoteClick,
}: ChatFeedbackSidebarProps) {
  const debriefQuery = useAiDebrief(documentId, null, isDocumentReady);

  const progressSignals = useMemo(() => {
    const summary = debriefQuery.data?.progressSummary ?? [];
    return {
      wordCount,
      draftVersion,
      hasFeedback: (debriefQuery.data?.items.length ?? 0) > 0,
      improvingCount: summary.filter((p) => p.tendency === 'improving').length,
      patternCount: summary.length,
    };
  }, [wordCount, draftVersion, debriefQuery.data]);

  const showChat = activeMode === 'chat';
  const showDebrief = activeMode === 'debrief';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={showChat ? 'h-full min-h-0' : 'hidden'}
        hidden={!showChat}
      >
        <WrenChatPanel
          documentId={documentId}
          draftId={draftId}
          draftVersion={draftVersion}
          progressSignals={progressSignals}
          askWrenService={askWrenService}
          className="h-full w-full"
          onHighlight={onHighlight}
          onChatQuoteClick={onChatQuoteClick}
          onHighlightText={onHighlightText}
          activeQuoteId={activeQuoteId}
        />
      </div>
      <div
        className={showDebrief ? 'h-full min-h-0' : 'hidden'}
        hidden={!showDebrief}
      >
        <SidebarDebriefPanel
          environmentId={documentId}
          autoRegenerate={false}
          isGenerating={isGeneratingFeedback}
          isTakingLonger={isTakingLonger}
          isDocumentReady={isDocumentReady}
          onBeforeRegenerate={onBeforeRegenerate}
          onFeedbackQueued={onFeedbackQueued}
          onGenerationFailed={onGenerationFailed}
          generationError={generationError}
          activeQuoteId={activeQuoteId}
          highlightFailed={highlightFailed}
          onQuoteClick={onQuoteClick}
        />
      </div>
    </div>
  );
}
