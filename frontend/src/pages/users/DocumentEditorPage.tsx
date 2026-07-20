import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

import { AnchoredFeedbackEditorContainer } from '@/features/editor';
import { MockAskWrenService } from '@/features/ask-wren';
import { ChatFeedbackSidebar } from '@/components/ChatFeedbackSidebar';
import { appConfig } from '@/config/env';
import { fetchDocument } from '@/features/dashboard/dashboardApi';
import { generateFeedback, fetchFeedbackStatus } from '@/features/editor/anchoredFeedbackApi';
import { tiptapContentToDocxBlob } from '@/features/editor/docxContentMapper';
import { apiClient } from '@/services';
import { queryKeys } from '@/hooks/queryKeys';

import type { JSONContent } from '@tiptap/react';

const askWrenService = new MockAskWrenService();

const previewEditorContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Tort Claim Proposal',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Person 1 and Person 2',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'This is about a negligence claim maybe and happened in Kelowna sometime in January. Person 1 was walking near a building and there was ice. It was cold for awhile before and snow happened and then Person 1 slipped really bad and hit their shoulder and head onto the ground which caused injuries and also stress because they couldn\'t work properly for some time and headaches happened too.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Damages',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Person 1 had pain and suffering and also had to miss work. It is believed maybe around $25,000 could be awarded but also maybe more because injuries can sometimes last long periods. Expenses happened too from medications and travel although receipts are not all available currently. Future treatment could happen depending if symptoms stay.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Evidence',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'There are witnesses who saw something happen and there was weather reports available. Medical papers exist from the hospital visit but not all of them were obtained yet. Cameras may have recorded the accident but this has not been looked into. Person 1 also remembers taking pictures but it is uncertain where they are now.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Legal Issues',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Duty of care exists because property owners usually should keep places safe. Person 2 owns the place probably and should have put salt down although it is not completely known who was responsible because there might have been another company doing maintenance. This should be investigated later perhaps.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Recommendation',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'A lawsuit should maybe be started because it seems unfair what happened and Person 1 suffered injuries. Before doing that maybe sending a letter first would help because settlements save money and time and courts can be complicated. More records should be gathered and doctors asked questions.',
        },
      ],
    },
  ],
};

const previewCategoryLabels: Readonly<Record<string, string>> = {
  'cat-clarity': 'Clarity',
  'cat-terminology': 'Terminology',
  'cat-grammar': 'Grammar',
  'cat-structure': 'Structure',
  'cat-content': 'Content',
};

export function DocumentEditorPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(420);
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | undefined>(undefined);
  const [showCoachHighlights, setShowCoachHighlights] = useState(false);
  const [isPollingFeedback, setIsPollingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<JSONContent>(
    (location.state as { initialContent?: JSONContent } | null)?.initialContent ?? previewEditorContent
  );

  const resizeRef = useRef<{ startX: number; startWidth: number; isDragging: boolean } | null>(null);
  const sidebarDivRef = useRef<HTMLDivElement | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startWidth: rightSidebarWidth,
      isDragging: true,
    };

    const handleMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = moveEvent.clientX - resizeRef.current.startX;
      const newWidth = Math.max(300, resizeRef.current.startWidth - delta);

      if (sidebarDivRef.current) {
        sidebarDivRef.current.style.width = `${newWidth}px`;
      }
    };

    const handleUp = () => {
      if (!resizeRef.current || !sidebarDivRef.current) return;
      const currentWidth = parseInt(sidebarDivRef.current.style.width, 10);
      setRightSidebarWidth(currentWidth);
      resizeRef.current.isDragging = false;

      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [rightSidebarWidth]);

  const envId = documentId ?? 'doc-1';

  const state = location.state as {
    documentName?: string;
    organizationName?: string;
    contentType?: string;
    initialContent?: JSONContent;
  } | null;

  // Fetch real document metadata (name, etc.) from the backend
  const { data: documentData } = useQuery({
    queryKey: ['document', envId],
    queryFn: () => fetchDocument(apiClient, envId),
    enabled: !!documentId,
  });

  const documentName = documentData?.name ?? state?.documentName ?? 'Tort Claim Proposal';

  const breadcrumb = [state?.organizationName, state?.contentType]
    .filter(Boolean)
    .join(' > ') || 'Law > Factum';

  // Generate feedback mutation + polling
  const generateFeedbackMutation = useMutation({
    mutationFn: () => generateFeedback(apiClient, envId),
    onMutate: () => {
      setFeedbackError(null);
    },
    onSuccess: () => {
      setIsPollingFeedback(true);
    },
    onError: (error) => {
      setFeedbackError(
        error instanceof Error ? error.message : 'Failed to queue feedback generation.',
      );
    },
  });

  // Poll feedback status after generation is queued
  useEffect(() => {
    if (!isPollingFeedback) return;

    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const status = await fetchFeedbackStatus(apiClient, envId);
          if (cancelled) return;

          if (status.status === 'completed') {
            setIsPollingFeedback(false);
            clearInterval(interval);
            setFeedbackError(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.inlineFeedbackItems(envId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.anchors(envId) });
            return;
          }

          if (status.status === 'failed') {
            setIsPollingFeedback(false);
            clearInterval(interval);
            setFeedbackError('Feedback generation failed. Please try again.');
          }
        } catch (error) {
          if (cancelled) return;
          setIsPollingFeedback(false);
          clearInterval(interval);
          setFeedbackError(
            error instanceof Error
              ? error.message
              : 'Could not check feedback status. Please try again.',
          );
        }
      })();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isPollingFeedback, envId, queryClient]);

  // Download current editor content as .docx
  const handleDownload = async () => {
    const blob = await tiptapContentToDocxBlob(currentContent);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${documentName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };


  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-muted/30">
      {/* Top bar */}
      <div className="shrink-0 border-b border-border-subtle bg-surface-primary px-2xl py-sm">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-sm text-bodySmall font-sans text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden="true">&larr;</span> Back to Dashboard
        </button>
      </div>

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar */}
        <aside
          className={`relative flex shrink-0 flex-col border-r border-border-subtle bg-surface-primary transition-[width] duration-300 ease-in-out ${
            leftSidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[280px]'
          }`}
        >
          <div className={`flex flex-1 flex-col p-lg ${leftSidebarCollapsed ? 'invisible' : 'visible'}`} style={{ minWidth: '280px' }}>
            {/* Document header */}
            <div className="flex flex-col gap-xs">
              <span className="text-caption font-sans text-text-muted">
                {breadcrumb}
              </span>
              <h2 className="text-heading3 font-sans font-bold text-text-primary">
                {documentName}
              </h2>
              <p className="text-caption text-text-secondary leading-relaxed">
                <strong>AI Debrief</strong> gives you a bird's-eye view of your writing: where you're excelling and where you could improve. Click any quote within the AI Debrief content to see it highlighted in your draft.
              </p>
              <p className="text-caption text-text-secondary leading-relaxed">
                <strong>Ask {appConfig.appName}</strong> takes you deeper. Ask specific questions to get guided reflections that help you think critically about your draft.
              </p>
            </div>

            <hr className="my-lg border-border-subtle" />

            {/* Action buttons — bottom aligned */}
            <nav className="mt-auto flex flex-col gap-sm" aria-label="Document actions">
              {/* Open feedback & chat sidebar */}
              <button
                type="button"
                onClick={() => setRightSidebarOpen(true)}
                className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
              >
                Open {appConfig.appName} and AI Debrief
              </button>

              {/* Divider between feedback and file actions */}
              <hr className="my-xs border-border-subtle" />

              {/* File actions */}
              <button
                type="button"
                onClick={handleDownload}
                className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted"
              >
                Download Document
              </button>
              <button
                type="button"
                onClick={() => generateFeedbackMutation.mutate()}
                disabled={generateFeedbackMutation.isPending || isPollingFeedback}
                className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPollingFeedback ? 'Generating…' : generateFeedbackMutation.isPending ? 'Queuing…' : 'Generate Feedback'}
              </button>
              {feedbackError && (
                <p role="alert" className="text-bodySmall text-signal-critical">
                  {feedbackError}
                </p>
              )}
            </nav>
          </div>

          {/* Resize handle on right edge */}
          <div className="absolute right-0 top-0 flex h-full w-[6px] cursor-col-resize items-center justify-center opacity-0 transition-opacity hover:opacity-100">
            <GripVertical size={12} className="text-text-muted" />
          </div>
        </aside>

        {/* Left sidebar collapse/expand toggle */}
        <button
          type="button"
          onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
          aria-label={leftSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="relative z-10 flex h-full w-[20px] shrink-0 items-center justify-center border-r border-border-subtle bg-surface-primary text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary"
        >
          {leftSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Editor area — centered with max-width for comfortable reading */}
        <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-2xl">
          <div className="w-full max-w-[960px]">
            <div className="min-h-full rounded-lg border border-border-subtle/50 bg-surface-primary p-2xl shadow-sm">
              <AnchoredFeedbackEditorContainer
                environmentId={envId}
                ariaLabel="Draft editor"
                initialContent={state?.initialContent ?? previewEditorContent}
                categoryLabels={previewCategoryLabels}
                highlightedAnchorId={highlightedAnchorId}
                showCoachHighlights={showCoachHighlights}
                onContentChange={(content) => setCurrentContent(content)}
              />
            </div>
          </div>
        </main>

        {/* Right panel: Writing Coach & AI Debrief sidebar */}
        {rightSidebarOpen && !rightSidebarCollapsed && (
          <div
            className="w-1 cursor-col-resize bg-border-subtle hover:bg-accent-primary/80 active:bg-accent-primary transition-colors flex items-center justify-center group"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-label="Drag to resize panel"
            aria-orientation="vertical"
          >
            <GripVertical size={18} className="text-accent-primary opacity-30 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
        <div
          ref={sidebarDivRef}
          className={`relative flex shrink-0 overflow-hidden border-l border-border-subtle shadow-[-4px_0_12px_rgba(0,0,0,0.05)] ${
            !rightSidebarOpen ? 'border-l-0' : ''
          }`}
          style={{
            width: rightSidebarOpen ? (rightSidebarCollapsed ? '20px' : `${rightSidebarWidth}px`) : '0px',
          }}
        >
          {rightSidebarOpen && (
            <button
              type="button"
              onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
              aria-label={rightSidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
              className="relative z-10 flex h-full w-[20px] shrink-0 items-center justify-center border-r border-border-subtle bg-surface-primary text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary"
            >
              {rightSidebarCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>
          )}

          <div
            className={`flex h-full flex-col bg-surface-primary flex-1 ${
              rightSidebarCollapsed ? 'hidden' : 'visible'
            }`}
          >
            <ChatFeedbackSidebar
              documentId={envId}
              draftId="draft-1"
              draftVersion={1}
              askWrenService={askWrenService}
              onHighlight={(anchorId) => {
                setHighlightedAnchorId(anchorId);
                setShowCoachHighlights(true);
              }}
              onQuoteClick={(anchorId) => {
                console.log('Quote clicked, anchor ID:', anchorId);
                setHighlightedAnchorId(anchorId);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
