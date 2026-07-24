/**
 * `<ChatFeedbackSidebar>` — unified right sidebar combining Writing Coach (Ask WREN)
 * and AI Debrief in a tabbed interface.
 *
 * Tabs are full-width button controls with icons + labels, matching the design
 * shown in Ask AWsentral screenshot. Users can switch between Writing Coach chat
 * and AI Debrief feedback. Active tab preference is persisted to localStorage.
 *
 * Task 4: Wires async feedback generation via onDebriefRegenerate callback.
 */
import { MessageSquare, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { WrenChatPanel, type AskWrenService } from '@/features/ask-wren';
import { SidebarDebriefPanel, useAiDebrief } from '@/features/debrief';
import { appConfig } from '@/config/env';

export interface ChatFeedbackSidebarProps {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  /** Live word count from the editor (preferred) or latest draft. */
  readonly wordCount?: number;
  readonly askWrenService: AskWrenService;
  readonly isGeneratingFeedback?: boolean;
  /** Persist editor content as a new draft before AI Debrief regenerate. */
  readonly onBeforeRegenerate?: () => Promise<void>;
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
  readonly onQuoteClick?: (selection: {
    feedbackItemId: string;
    anchorId?: string;
    quotedText?: string;
  }) => void;
}

type TabType = 'chat' | 'debrief';

const ACTIVE_TAB_KEY = 'wren-active-sidebar-tab';

export function ChatFeedbackSidebar({
  documentId,
  draftId,
  draftVersion,
  wordCount = 0,
  askWrenService,
  isGeneratingFeedback = false,
  onBeforeRegenerate,
  onHighlight,
  onChatQuoteClick,
  onHighlightText,
  activeQuoteId,
  onQuoteClick,
}: ChatFeedbackSidebarProps) {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const debriefQuery = useAiDebrief(documentId);

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

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY) as TabType | null;
    if (stored === 'chat' || stored === 'debrief') {
      setActiveTab(stored);
    }
  }, []);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab buttons — full width */}
      <div className="flex border-b border-border-subtle bg-surface-muted/50">
        <button
          type="button"
          onClick={() => handleTabChange('chat')}
          className={`flex-1 flex items-center justify-center gap-sm px-md py-md text-bodySmall font-sans font-semibold transition-colors ${
            activeTab === 'chat'
              ? 'bg-surface-primary text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-pressed={activeTab === 'chat'}
        >
          <MessageSquare size={18} aria-hidden="true" />
          {appConfig.appName}
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('debrief')}
          className={`flex-1 flex items-center justify-center gap-sm px-md py-md text-bodySmall font-sans font-semibold transition-colors ${
            activeTab === 'debrief'
              ? 'bg-surface-primary text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-pressed={activeTab === 'debrief'}
        >
          <Sparkles size={18} aria-hidden="true" />
          AI Debrief
        </button>
      </div>

      {/* Tab content — keep both panels mounted so Ask chat state survives tab switches */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={activeTab === 'chat' ? 'h-full' : 'hidden'} hidden={activeTab !== 'chat'}>
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
          className={activeTab === 'debrief' ? 'h-full' : 'hidden'}
          hidden={activeTab !== 'debrief'}
        >
          <SidebarDebriefPanel
            environmentId={documentId}
            autoRegenerate={false}
            isGenerating={isGeneratingFeedback}
            onBeforeRegenerate={onBeforeRegenerate}
            activeQuoteId={activeQuoteId}
            onQuoteClick={onQuoteClick}
          />
        </div>
      </div>
    </div>
  );
}
