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
import { useEffect, useState } from 'react';

import { WrenChatPanel, type AskWrenService } from '@/features/ask-wren';
import { SidebarDebriefPanel } from '@/features/debrief';
import { useRequestFeedback } from '@/hooks';

export interface ChatFeedbackSidebarProps {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly askWrenService: AskWrenService;
  readonly onDebriefRegenerate?: (autoReegen: boolean) => void;
  readonly onHighlight?: (anchorId: string) => void;
  readonly onQuoteClick?: (anchorId: string | undefined) => void;
}

type TabType = 'chat' | 'debrief';

const ACTIVE_TAB_KEY = 'wren-active-sidebar-tab';

export function ChatFeedbackSidebar({
  documentId,
  draftId,
  draftVersion,
  askWrenService,
  onDebriefRegenerate,
  onHighlight,
  onQuoteClick,
}: ChatFeedbackSidebarProps) {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const requestFeedback = useRequestFeedback();

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

  const handleDebriefRegenerate = async (autoRegenerate: boolean) => {
    // Auto regenerate on first debrief request, or manual regenerate
    if (autoRegenerate) {
      await requestFeedback.mutateAsync(documentId);
    }
    onDebriefRegenerate?.(autoRegenerate);
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
          Writing Coach
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

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' && (
          <WrenChatPanel
            documentId={documentId}
            draftId={draftId}
            draftVersion={draftVersion}
            askWrenService={askWrenService}
            className="h-full w-full"
            onHighlight={onHighlight}
          />
        )}
        {activeTab === 'debrief' && (
          <SidebarDebriefPanel
            environmentId={documentId}
            autoRegenerate={false}
            onQuoteClick={onQuoteClick}
          />
        )}
      </div>
    </div>
  );
}
