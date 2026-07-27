import { useState, useCallback, useRef, useEffect, useMemo, type ComponentType } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  House,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

import { AnchoredFeedbackEditorContainer } from '@/features/editor';
import { createAskWrenService } from '@/features/ask-wren';
import {
  ChatFeedbackSidebar,
  type DocumentNavMode,
} from '@/components/ChatFeedbackSidebar';
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

const ACTIVE_NAV_KEY = 'wren-active-sidebar-tab';
const PANEL_WIDTH_DEFAULT = 360;
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 520;
const RAIL_WIDTH_PX = 72;

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

function readStoredNavMode(): DocumentNavMode {
  try {
    const stored = localStorage.getItem(ACTIVE_NAV_KEY);
    if (stored === 'home' || stored === 'chat' || stored === 'debrief') return stored;
  } catch {
    // ignore
  }
  return 'home';
}

export function DocumentEditorPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [activeNav, setActiveNav] = useState<DocumentNavMode>(() => readStoredNavMode());
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT);

  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | undefined>(undefined);
  const [highlightedQuotedText, setHighlightedQuotedText] = useState<string | undefined>(
    undefined,
  );
  const [highlightedLocationHint, setHighlightedLocationHint] = useState<string | undefined>(
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

  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const panelDivRef = useRef<HTMLDivElement | null>(null);

  const handleNavChange = useCallback((mode: DocumentNavMode) => {
    setActiveNav(mode);
    setPanelCollapsed(false);
    try {
      localStorage.setItem(ACTIVE_NAV_KEY, mode);
    } catch {
      // ignore
    }
  }, []);

  const handlePanelResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      resizeRef.current = {
        startX: e.clientX,
        startWidth: panelWidth,
      };

      const handleMove = (moveEvent: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = moveEvent.clientX - resizeRef.current.startX;
        const next = Math.min(
          PANEL_WIDTH_MAX,
          Math.max(PANEL_WIDTH_MIN, resizeRef.current.startWidth + delta),
        );
        if (panelDivRef.current) {
          panelDivRef.current.style.width = `${next}px`;
        }
      };

      const handleUp = () => {
        if (!resizeRef.current || !panelDivRef.current) return;
        const currentWidth = parseInt(panelDivRef.current.style.width, 10);
        if (!Number.isNaN(currentWidth)) {
          setPanelWidth(currentWidth);
        }
        resizeRef.current = null;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [panelWidth],
  );

  const envId = documentId ?? 'doc-1';

  const { data: documentData } = useQuery({
    queryKey: ['document', envId],
    queryFn: () => fetchDocument(apiClient, envId),
    enabled: !!documentId,
  });

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

  const saveDraftFromEditor = useCallback(async () => {
    const segments = segmentsFromEditorContent(currentContent);
    await createDraft(apiClient, envId, segments);
    await queryClient.invalidateQueries({ queryKey: ['document-draft', envId] });
  }, [currentContent, envId, queryClient]);

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
            void queryClient.invalidateQueries({
              queryKey: [...queryKeys.debrief(envId).slice(0, 4)],
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.debriefHistory(envId),
            });
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

  const handleDownload = async () => {
    const blob = await tiptapContentToDocxBlob(currentContent);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${documentName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const railItems: Array<{
    id: DocumentNavMode;
    label: string;
    icon: ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  }> = [
    { id: 'home', label: 'Home', icon: House },
    { id: 'chat', label: appConfig.appName, icon: MessageSquare },
    { id: 'debrief', label: 'AI Debrief', icon: Sparkles },
  ];

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

      <div className="flex min-h-0 flex-1">
        {/* Icon rail — Teams/Slack style */}
        <nav
          aria-label="Document views"
          className="flex shrink-0 flex-col items-stretch gap-xs border-r border-border-subtle bg-surface-muted/60 py-sm"
          style={{ width: RAIL_WIDTH_PX }}
        >
          {railItems.map((item) => {
            const isActive = activeNav === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavChange(item.id)}
                aria-pressed={isActive}
                className={[
                  'relative flex flex-col items-center gap-[2px] px-xs py-sm text-center transition-colors',
                  isActive
                    ? 'text-text-primary'
                    : 'text-text-muted hover:bg-surface-muted hover:text-text-secondary',
                ].join(' ')}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-sm bg-accent-primary"
                  />
                )}
                <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />
                <span className="max-w-full truncate px-[2px] text-[10px] font-sans font-medium leading-tight">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Content panel for the selected rail item */}
        <aside
          ref={panelDivRef}
          className={`relative flex shrink-0 flex-col border-r border-border-subtle bg-surface-primary ${
            panelCollapsed ? 'overflow-hidden border-r-0' : ''
          }`}
          style={{ width: panelCollapsed ? 0 : panelWidth }}
        >
          <div
            className={`flex h-full min-h-0 w-full flex-col ${panelCollapsed ? 'invisible' : 'visible'}`}
            style={{ minWidth: PANEL_WIDTH_MIN }}
            aria-hidden={panelCollapsed}
          >
              {/* Home stays in the tree only when selected; coach panels stay mounted. */}
              <div
                className={activeNav === 'home' ? 'flex h-full min-h-0 flex-col' : 'hidden'}
                hidden={activeNav !== 'home'}
              >
                <div className="flex flex-1 flex-col overflow-y-auto p-lg">
                  <div className="flex flex-col gap-xs">
                    <span className="text-caption font-sans text-text-muted">{breadcrumb}</span>
                    <h2 className="text-heading3 font-sans font-bold text-text-primary">
                      {documentName}
                    </h2>
                    <p className="text-caption text-text-secondary leading-relaxed">
                      Use the rail to open Ask {appConfig.appName} or AI Debrief. Edit inline in
                      the draft, or upload a revised file below.
                    </p>
                  </div>

                  <hr className="my-lg border-border-subtle" />

                  <nav className="mt-auto flex flex-col gap-sm" aria-label="Document actions">
                    <div className="flex flex-col gap-xs">
                      <p className="text-caption font-semibold text-text-primary">
                        Revise your draft
                      </p>
                      <p className="text-caption text-text-muted leading-relaxed">
                        <strong>Edit inline</strong>, then Regenerate in AI Debrief — or{' '}
                        <strong>upload a new draft</strong> to refresh feedback automatically.
                      </p>
                    </div>

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
                      className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resubmitDraftMutation.isPending ? 'Uploading…' : 'Upload New Draft'}
                    </button>
                    {resubmitDraftMutation.isError && (
                      <p role="alert" className="text-bodySmall text-signal-critical">
                        {errorMessageFromUnknown(resubmitDraftMutation.error)}
                      </p>
                    )}

                    <hr className="my-xs border-border-subtle" />

                    <button
                      type="button"
                      onClick={handleDownload}
                      className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted"
                    >
                      Download Document
                    </button>
                  </nav>
                </div>
              </div>

              <div
                className={
                  activeNav === 'chat' || activeNav === 'debrief'
                    ? 'h-full min-h-0'
                    : 'hidden'
                }
                hidden={activeNav === 'home'}
              >
                <ChatFeedbackSidebar
                  documentId={envId}
                  draftId={draftId}
                  draftVersion={draftVersion}
                  activeMode={activeNav}
                  wordCount={wordCountFromEditorContent(currentContent)}
                  askWrenService={askWrenService}
                  isGeneratingFeedback={isPollingFeedback}
                  onBeforeRegenerate={saveDraftFromEditor}
                  onHighlight={(anchorId) => {
                    setActiveQuoteId(`ask:${anchorId}`);
                    setHighlightedAnchorId(anchorId);
                    setHighlightedQuotedText(undefined);
                    setHighlightedLocationHint(undefined);
                    setShowCoachHighlights(true);
                  }}
                  onChatQuoteClick={(selection) => {
                    if (activeQuoteId === selection.quoteKey) {
                      setActiveQuoteId(undefined);
                      setHighlightedAnchorId(undefined);
                      setHighlightedQuotedText(undefined);
                      setHighlightedLocationHint(undefined);
                      return;
                    }
                    setActiveQuoteId(selection.quoteKey);
                    setHighlightedAnchorId(undefined);
                    setHighlightedQuotedText(selection.quotedText);
                    setHighlightedLocationHint(selection.locationHint);
                    setShowCoachHighlights(true);
                  }}
                  activeQuoteId={activeQuoteId}
                  onQuoteClick={(selection) => {
                    if (activeQuoteId === selection.feedbackItemId) {
                      setActiveQuoteId(undefined);
                      setHighlightedAnchorId(undefined);
                      setHighlightedQuotedText(undefined);
                      setHighlightedLocationHint(undefined);
                      return;
                    }
                    setActiveQuoteId(selection.feedbackItemId);
                    setHighlightedAnchorId(selection.anchorId);
                    setHighlightedQuotedText(selection.quotedText);
                    setHighlightedLocationHint(undefined);
                  }}
                />
              </div>
          </div>
        </aside>

        {/* Panel collapse + resize */}
        {!panelCollapsed && (
          <div
            className="group flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border-subtle transition-colors hover:bg-accent-primary/80 active:bg-accent-primary"
            onMouseDown={handlePanelResizeStart}
            role="separator"
            aria-label="Drag to resize panel"
            aria-orientation="vertical"
          >
            <GripVertical
              size={16}
              className="text-accent-primary opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setPanelCollapsed((c) => !c)}
          aria-label={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
          className="relative z-10 flex h-full w-[20px] shrink-0 items-center justify-center border-r border-border-subtle bg-surface-primary text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary"
        >
          {panelCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Editor — always visible */}
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
                  highlightedLocationHint={highlightedLocationHint}
                  showCoachHighlights={showCoachHighlights}
                  onContentChange={(content) => setCurrentContent(content)}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
