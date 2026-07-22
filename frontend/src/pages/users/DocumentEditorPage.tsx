import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

import { AnchoredFeedbackEditorContainer } from '@/features/editor';
import { createAskWrenService } from '@/features/ask-wren';
import { ChatFeedbackSidebar } from '@/components/ChatFeedbackSidebar';
import { appConfig } from '@/config/env';
import {
  fetchDocument,
  fetchLatestDraft,
  createDraft,
  createDraftFromSource,
  getPresignedUrl,
} from '@/features/dashboard/dashboardApi';
import { fetchFeedbackStatus, generateFeedback } from '@/features/editor/anchoredFeedbackApi';
import {
  segmentsToTiptapContent,
  tiptapContentToDocxBlob,
} from '@/features/editor/docxContentMapper';
import { apiClient, ApiError } from '@/services';
import { queryKeys } from '@/hooks/queryKeys';

import type { JSONContent } from '@tiptap/react';

const askWrenService = createAskWrenService(apiClient);

const EMPTY_EDITOR_CONTENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const previewCategoryLabels: Readonly<Record<string, string>> = {
  'cat-clarity': 'Clarity',
  'cat-terminology': 'Terminology',
  'cat-grammar': 'Grammar',
  'cat-structure': 'Structure',
  'cat-content': 'Content',
};

function contentTypeForFile(file: File): string {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function segmentsFromEditorContent(
  content: JSONContent,
): Array<{ index: number; text: string }> {
  return (content.content ?? []).map((block, idx) => ({
    index: idx,
    text: (block.content ?? [])
      .filter((n) => n.type === 'text')
      .map((n) => n.text ?? '')
      .join(''),
  }));
}

function wordCountFromEditorContent(content: JSONContent): number {
  return segmentsFromEditorContent(content).reduce(
    (total, seg) => total + seg.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'message' in details) {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

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
  const [highlightedQuotedText, setHighlightedQuotedText] = useState<string | undefined>(
    undefined,
  );
  const [activeQuoteId, setActiveQuoteId] = useState<string | undefined>(undefined);
  const [showCoachHighlights, setShowCoachHighlights] = useState(false);
  // Start polling immediately if we arrived from a fresh upload (router state
  // carries feedbackQueued / legacy initialContent when feedback was auto-queued).
  const [isPollingFeedback, setIsPollingFeedback] = useState(() => {
    const s = location.state as { feedbackQueued?: boolean; initialContent?: unknown } | null;
    return !!(s?.feedbackQueued || s?.initialContent);
  });

  const state = location.state as {
    documentName?: string;
    organizationName?: string;
    contentType?: string;
    initialContent?: JSONContent;
    feedbackQueued?: boolean;
  } | null;

  const routerInitialContent = state?.initialContent;
  const [currentContent, setCurrentContent] = useState<JSONContent>(
    routerInitialContent ?? EMPTY_EDITOR_CONTENT,
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

  // Fetch real document metadata (name, etc.) from the backend
  const { data: documentData } = useQuery({
    queryKey: ['document', envId],
    queryFn: () => fetchDocument(apiClient, envId),
    enabled: !!documentId,
  });

  // Load the latest draft body when opening from the dashboard (no router state).
  const draftQuery = useQuery({
    queryKey: ['document-draft', envId],
    queryFn: () => fetchLatestDraft(apiClient, envId),
    enabled: !!documentId,
  });

  const draftContent = useMemo(
    () => (draftQuery.data ? segmentsToTiptapContent(draftQuery.data.segments) : null),
    [draftQuery.data],
  );

  const editorInitialContent = routerInitialContent ?? draftContent ?? EMPTY_EDITOR_CONTENT;
  const editorReady = Boolean(routerInitialContent) || draftQuery.isSuccess || draftQuery.isError;
  const editorMountKey = routerInitialContent
    ? `router-${envId}`
    : `draft-${draftQuery.data?.id ?? envId}`;

  useEffect(() => {
    if (routerInitialContent) {
      setCurrentContent(routerInitialContent);
      return;
    }
    if (draftContent) {
      setCurrentContent(draftContent);
    }
  }, [routerInitialContent, draftContent]);

  const documentName = documentData?.name ?? state?.documentName ?? 'Untitled document';

  const breadcrumb = [state?.organizationName, state?.contentType]
    .filter(Boolean)
    .join(' > ') || 'Document';

  const draftId = draftQuery.data?.id ?? 'draft-pending';
  const draftVersion = draftQuery.data?.versionNumber ?? 1;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Persist TipTap content as a new draft before Regenerate runs feedback. */
  const saveDraftFromEditor = useCallback(async () => {
    const segments = segmentsFromEditorContent(currentContent);
    await createDraft(apiClient, envId, segments);
    await queryClient.invalidateQueries({ queryKey: ['document-draft', envId] });
  }, [currentContent, envId, queryClient]);

  /** Resubmit = re-upload a .docx/.pdf onto this same document as a new draft. */
  const resubmitDraftMutation = useMutation({
    mutationFn: async (file: File) => {
      const { uploadUrl, key } = await getPresignedUrl(
        apiClient,
        file.name,
        contentTypeForFile(file),
      );

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentTypeForFile(file) },
      });
      if (!putResponse.ok) {
        throw new Error('File upload to storage failed');
      }

      return createDraftFromSource(apiClient, envId, { kind: 'file', key });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-draft', envId] });
      setIsPollingFeedback(true);
      void generateFeedback(apiClient, envId).catch(() => {
        // Non-fatal: student can Regenerate from the debrief panel.
      });
    },
  });

  const handleResubmitClick = () => {
    fileInputRef.current?.click();
  };

  const handleResubmitFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resubmitDraftMutation.mutate(file);
  };

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
            void queryClient.invalidateQueries({ queryKey: queryKeys.inlineFeedbackItems(envId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.debrief(envId) });
            return;
          }

          if (status.status === 'failed') {
            setIsPollingFeedback(false);
            clearInterval(interval);
          }
        } catch {
          if (cancelled) return;
          setIsPollingFeedback(false);
          clearInterval(interval);
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
                onClick={() => { setRightSidebarOpen(true); setRightSidebarCollapsed(false); }}
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                className="hidden"
                onChange={handleResubmitFileChange}
              />
              <button
                type="button"
                onClick={handleResubmitClick}
                disabled={resubmitDraftMutation.isPending}
                className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resubmitDraftMutation.isPending ? 'Uploading…' : 'Upload New Draft'}
              </button>
              <p className="text-caption text-text-muted leading-relaxed">
                Upload a revised .docx or .pdf for this document.
              </p>
              {resubmitDraftMutation.isError && (
                <p role="alert" className="text-bodySmall text-signal-critical">
                  {errorMessageFromUnknown(resubmitDraftMutation.error)}
                </p>
              )}
              {resubmitDraftMutation.isSuccess && !resubmitDraftMutation.isPending && (
                <p className="text-bodySmall text-signal-positive">
                  Draft uploaded — generating updated feedback…
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
              {!editorReady ? (
                <p role="status" className="text-bodySmall text-text-secondary">
                  Loading document…
                </p>
              ) : (
                <AnchoredFeedbackEditorContainer
                  key={editorMountKey}
                  environmentId={envId}
                  ariaLabel="Draft editor"
                  initialContent={editorInitialContent}
                  categoryLabels={previewCategoryLabels}
                  highlightedAnchorId={highlightedAnchorId}
                  highlightedQuotedText={highlightedQuotedText}
                  showCoachHighlights={showCoachHighlights}
                  onContentChange={(content) => setCurrentContent(content)}
                />
              )}
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
              draftId={draftId}
              draftVersion={draftVersion}
              wordCount={wordCountFromEditorContent(currentContent)}
              askWrenService={askWrenService}
              isGeneratingFeedback={isPollingFeedback}
              onBeforeRegenerate={saveDraftFromEditor}
              onHighlight={(anchorId) => {
                setActiveQuoteId(`ask:${anchorId}`);
                setHighlightedAnchorId(anchorId);
                setHighlightedQuotedText(undefined);
                setShowCoachHighlights(true);
              }}
              activeQuoteId={activeQuoteId}
              onQuoteClick={(selection) => {
                if (activeQuoteId === selection.feedbackItemId) {
                  setActiveQuoteId(undefined);
                  setHighlightedAnchorId(undefined);
                  setHighlightedQuotedText(undefined);
                  return;
                }
                setActiveQuoteId(selection.feedbackItemId);
                setHighlightedAnchorId(selection.anchorId);
                setHighlightedQuotedText(selection.quotedText);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
