import { useState, useCallback, useRef, useEffect, useMemo, type ComponentType } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Download,
  GripVertical,
  ListTree,
  MessageSquare,
  PanelLeftClose,
  Sparkles,
  Upload,
} from 'lucide-react';

import { AnchoredFeedbackEditorContainer, HomeSidePanel } from '@/features/editor';
import type { TableOfContentData } from '@/features/editor';
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
  docxBytesToTiptapContent,
} from '@/features/editor/docxContentMapper';
import { pdfBytesToTiptapContent } from '@/features/editor/pdfContentMapper';
import { apiClient, ApiError } from '@/services';
import { queryKeys } from '@/hooks/queryKeys';
import {
  isTipTapDoc,
  asTipTapDoc,
  stripAiMarksFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
} from '@wren/types';

import type { JSONContent } from '@tiptap/react';

const askWrenService = createAskWrenService(apiClient);

const ACTIVE_NAV_KEY = 'wren-active-sidebar-tab';
const PANEL_WIDTH_DEFAULT = 320;
/** AI Debrief needs more room for the progress chart labels. */
const PANEL_WIDTH_DEBRIEF = 420;
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 560;
const RAIL_WIDTH_PX = 76;

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
  return tipTapContentToSegments(content);
}

function wordCountFromEditorContent(content: JSONContent): number {
  return wordCountFromTipTapContent(content);
}

async function parseUploadToTipTap(file: File): Promise<JSONContent | undefined> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) return await docxBytesToTiptapContent(bytes);
    if (name.endsWith('.pdf')) return await pdfBytesToTiptapContent(bytes);
  } catch {
    // Non-fatal: server plain-text ingest remains the fallback.
  }
  return undefined;
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
  // Home stays open so Overview + TOC remain visible; Ask/Debrief also use the panel.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() =>
    readStoredNavMode() === 'debrief' ? PANEL_WIDTH_DEBRIEF : PANEL_WIDTH_DEFAULT,
  );
  const [tocAnchors, setTocAnchors] = useState<TableOfContentData>([]);

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
    // Keep the side panel open for Home (TOC) and coaching modes.
    setPanelCollapsed(false);
    // Widen for AI Debrief so progress chart labels (Improving / Persistent /
    // Emerging) fit without clipping; leave a manually widened panel alone.
    if (mode === 'debrief') {
      setPanelWidth((current) =>
        current < PANEL_WIDTH_DEBRIEF ? PANEL_WIDTH_DEBRIEF : current,
      );
    }
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

  const draftContent = useMemo(() => {
    if (!draftQuery.data) return null;
    if (isTipTapDoc(draftQuery.data.content)) {
      return draftQuery.data.content as JSONContent;
    }
    return segmentsToTiptapContent(draftQuery.data.segments);
  }, [draftQuery.data]);

  // Prefer persisted draft.content over ephemeral router state so reload matches DB.
  const editorInitialContent = draftContent ?? routerInitialContent ?? EMPTY_EDITOR_CONTENT;
  const editorReady = draftQuery.isSuccess || draftQuery.isError || Boolean(routerInitialContent);
  const editorMountKey = `draft-${draftQuery.data?.id ?? envId}-${draftQuery.data?.versionNumber ?? 0}`;

  useEffect(() => {
    if (draftContent) {
      setCurrentContent(draftContent);
      return;
    }
    if (routerInitialContent) {
      setCurrentContent(routerInitialContent);
    }
  }, [draftContent, routerInitialContent]);

  const documentName = documentData?.name ?? state?.documentName ?? 'Untitled document';

  const breadcrumb = [state?.organizationName, state?.contentType]
    .filter(Boolean)
    .join(' > ') || 'Document';

  const draftId = draftQuery.data?.id ?? 'draft-pending';
  const draftVersion = draftQuery.data?.versionNumber ?? 1;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const saveDraftFromEditor = useCallback(async () => {
    const cleaned = asTipTapDoc(stripAiMarksFromTipTapContent(currentContent));
    const segments = cleaned
      ? tipTapContentToSegments(cleaned)
      : segmentsFromEditorContent(currentContent);
    await createDraft(apiClient, envId, segments, cleaned);
    await queryClient.invalidateQueries({ queryKey: ['document-draft', envId] });
  }, [currentContent, envId, queryClient]);

  const resubmitDraftMutation = useMutation({
    mutationFn: async (file: File) => {
      const isDocx = file.name.toLowerCase().endsWith('.docx');
      // DOCX: client TipTap. PDF: server LiteParse is source of truth (1C).
      const tipTap = isDocx ? await parseUploadToTipTap(file) : undefined;
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

      const cleaned = tipTap
        ? asTipTapDoc(stripAiMarksFromTipTapContent(tipTap))
        : undefined;
      return createDraftFromSource(
        apiClient,
        envId,
        { kind: 'file', key },
        cleaned,
      );
    },
    onSuccess: (draft) => {
      if (isTipTapDoc(draft.content)) {
        setCurrentContent(draft.content as JSONContent);
      }
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
    const cleaned = stripAiMarksFromTipTapContent(currentContent) as JSONContent;
    const blob = await tiptapContentToDocxBlob(cleaned);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${documentName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const wordCount = wordCountFromEditorContent(currentContent);

  const railItems: Array<{
    id: DocumentNavMode;
    label: string;
    icon: ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  }> = [
    { id: 'home', label: 'Contents', icon: ListTree },
    { id: 'chat', label: appConfig.appName, icon: MessageSquare },
    { id: 'debrief', label: 'AI Debrief', icon: Sparkles },
  ];

  const railButtonClass = (isActive: boolean) =>
    [
      'relative flex min-h-11 w-full flex-col items-center justify-center gap-[2px] px-xs py-sm text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong',
      isActive
        ? 'bg-surface-primary text-text-primary'
        : 'text-text-muted hover:bg-surface-muted hover:text-text-secondary',
    ].join(' ');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-muted/40">
      {/* Top bar — document name lives here so the draft stays the visual hero */}
      <div className="flex shrink-0 items-center gap-md border-b border-border-subtle bg-surface-primary px-xl py-sm">
        <div className="flex min-w-0 items-center gap-md">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="shrink-0 text-bodySmall font-sans text-text-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-strong"
          >
            <span aria-hidden="true">&larr;</span> Dashboard
          </button>
          <span aria-hidden="true" className="text-border-subtle">
            /
          </span>
          <div className="min-w-0">
            <p className="truncate text-bodySmall font-sans font-semibold text-text-primary">
              {documentName}
            </p>
            <p className="truncate text-caption text-text-muted">
              {breadcrumb !== 'Document' ? `${breadcrumb} · ` : ''}
              Draft v{draftVersion} · {wordCount.toLocaleString()} words
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Icon nav — ~44px hit targets, caption labels */}
        <nav
          aria-label="Document views"
          className="flex shrink-0 flex-col items-stretch border-r border-border-subtle bg-surface-muted/70"
          style={{ width: RAIL_WIDTH_PX }}
        >
          <div className="flex flex-col items-stretch gap-[2px] pt-xs">
            {railItems.map((item) => {
              const isActive = activeNav === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavChange(item.id)}
                  aria-pressed={isActive}
                  className={railButtonClass(isActive)}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-sm bg-accent-primary"
                    />
                  )}
                  <Icon size={20} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />
                  <span className="max-w-full truncate px-[2px] text-caption font-sans font-medium leading-tight">
                    {item.label}
                  </span>
                </button>
              );
            })}
            {!panelCollapsed && (
              <button
                type="button"
                onClick={() => setPanelCollapsed(true)}
                aria-label="Close panel"
                title="Close panel"
                className={railButtonClass(false)}
              >
                <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className="max-w-full truncate px-[2px] text-caption font-sans font-medium leading-tight">
                  Close
                </span>
              </button>
            )}
          </div>

          <div
            className="mt-auto flex flex-col items-stretch gap-[2px] border-t border-border-subtle pb-xs pt-xs"
            aria-label="File actions"
          >
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
              title={
                resubmitDraftMutation.isError
                  ? errorMessageFromUnknown(resubmitDraftMutation.error)
                  : 'Upload a revised draft'
              }
              aria-label={
                resubmitDraftMutation.isPending ? 'Uploading new draft' : 'Upload new draft'
              }
              className={`${railButtonClass(false)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Upload size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="max-w-full px-[2px] text-caption font-sans font-medium leading-tight">
                {resubmitDraftMutation.isPending ? 'Uploading' : 'Upload'}
              </span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Download"
              aria-label="Download"
              className={railButtonClass(false)}
            >
              <Download size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="max-w-full px-[2px] text-caption font-sans font-medium leading-tight">
                Download
              </span>
            </button>
          </div>
        </nav>

        {/* Side panel — coaching / compact home status */}
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
            <div
              className={activeNav === 'home' ? 'flex h-full min-h-0 flex-col' : 'hidden'}
              hidden={activeNav !== 'home'}
            >
              <HomeSidePanel anchors={tocAnchors} />
            </div>

            <div
              className={
                activeNav === 'chat' || activeNav === 'debrief' ? 'h-full min-h-0' : 'hidden'
              }
              hidden={activeNav === 'home'}
            >
              <ChatFeedbackSidebar
                documentId={envId}
                draftId={draftId}
                draftVersion={draftVersion}
                activeMode={activeNav}
                wordCount={wordCount}
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

        {!panelCollapsed && (
          <div
            className="group flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border-subtle/80 transition-colors hover:bg-accent-primary/70 active:bg-accent-primary"
            onMouseDown={handlePanelResizeStart}
            role="separator"
            aria-label="Drag to resize panel"
            aria-orientation="vertical"
          >
            <GripVertical
              size={14}
              className="text-text-muted opacity-40 transition-opacity group-hover:opacity-100"
            />
          </div>
        )}

        {/* Editor — Google Docs-style: full-height page, one scroll */}
        <main className="document-editor-scroll min-h-0 flex-1 bg-surface-muted/50">
          <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col bg-surface-primary px-2xl pb-2xl pt-0 shadow-sm sm:px-3xl sm:pb-3xl">
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
                onTocUpdate={setTocAnchors}
                className="min-h-0 flex-1"
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
