import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

import { AnchoredFeedbackEditorContainer } from '@/features/editor';
import { AiDebriefModal } from '@/features/debrief';
import { WrenChatPanel, MockAskWrenService } from '@/features/ask-wren';
import { appConfig } from '@/config/env';

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
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [debriefAutoRegenerate, setDebriefAutoRegenerate] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const envId = documentId ?? 'doc-1';

  const state = location.state as {
    documentName?: string;
    writingType?: string;
    writingDomain?: string;
    contentType?: string;
  } | null;

  const documentName = state?.documentName ?? 'Tort Claim Proposal';

  const breadcrumb = [state?.writingType, state?.writingDomain, state?.contentType]
    .filter(Boolean)
    .join(' › ') || 'Law › Tort Law › Factum';

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
            sidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[280px]'
          }`}
        >
          <div className={`flex flex-1 flex-col p-lg ${sidebarCollapsed ? 'invisible' : 'visible'}`} style={{ minWidth: '280px' }}>
            {/* Document header */}
            <div className="flex flex-col gap-xs">
              <span className="text-caption font-sans text-text-muted">
                {breadcrumb}
              </span>
              <h2 className="text-heading3 font-sans font-bold text-text-primary">
                {documentName}
              </h2>
            </div>

            <hr className="my-lg border-border-subtle" />

            {/* Action buttons — bottom aligned */}
            <nav className="mt-auto flex flex-col gap-sm" aria-label="Document actions">
              {/* Feedback actions */}
              <button
                type="button"
                onClick={() => { setDebriefAutoRegenerate(false); setDebriefOpen(true); }}
                className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
              >
                View AI Debrief
              </button>
              <button
                type="button"
                onClick={() => { setDebriefAutoRegenerate(true); setDebriefOpen(true); }}
                className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
              >
                Regenerate AI Debrief
              </button>
              <button
                type="button"
                onClick={() => setChatOpen(!chatOpen)}
                className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
              >
                Ask {appConfig.appName}
              </button>

              {/* Divider between feedback and file actions */}
              <hr className="my-xs border-border-subtle" />

              {/* File actions */}
              <button
                type="button"
                className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted"
              >
                Download Document
              </button>
              <button
                type="button"
                className="w-full rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted"
              >
                Re-Upload Document
              </button>
            </nav>
          </div>

          {/* Resize handle on right edge */}
          <div className="absolute right-0 top-0 flex h-full w-[6px] cursor-col-resize items-center justify-center opacity-0 transition-opacity hover:opacity-100">
            <GripVertical size={12} className="text-text-muted" />
          </div>
        </aside>

        {/* Sidebar collapse/expand toggle */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="relative z-10 flex h-full w-[20px] shrink-0 items-center justify-center border-r border-border-subtle bg-surface-primary text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary"
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Editor area — centered with max-width for comfortable reading */}
        <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-2xl">
          <div className="w-full max-w-[960px]">
            <div className="min-h-full rounded-lg border border-border-subtle/50 bg-surface-primary p-2xl shadow-sm">
              <AnchoredFeedbackEditorContainer
                environmentId={envId}
                ariaLabel="Draft editor"
                initialContent={previewEditorContent}
                categoryLabels={previewCategoryLabels}
              />
            </div>
          </div>
        </main>

        {/* Right panel: Ask Writing Coach — slides in/out */}
        <div
          className={`relative shrink-0 overflow-hidden border-l border-border-subtle shadow-[-4px_0_12px_rgba(0,0,0,0.05)] transition-all duration-300 ease-in-out ${
            chatOpen ? 'w-[420px]' : 'w-0 border-l-0'
          }`}
        >
          <div className="flex h-full w-[420px] flex-col bg-surface-primary">
            {/* Chat panel collapse toggle */}
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              aria-label="Close chat panel"
              className="absolute left-0 top-1/2 z-10 flex h-[40px] w-[20px] -translate-x-full -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-border-subtle bg-surface-primary text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary"
            >
              <ChevronRight size={14} />
            </button>

            {/* Resize handle on left edge */}
            <div className="absolute left-0 top-0 flex h-full w-[6px] cursor-col-resize items-center justify-center opacity-0 transition-opacity hover:opacity-100">
              <GripVertical size={12} className="text-text-muted" />
            </div>

            <WrenChatPanel
              documentId={envId}
              draftId="draft-1"
              draftVersion={1}
              askWrenService={askWrenService}
              className="h-full w-full"
            />
          </div>
        </div>
      </div>

      <AiDebriefModal
        environmentId={envId}
        open={debriefOpen}
        onOpenChange={(next) => {
          setDebriefOpen(next);
          if (!next) setDebriefAutoRegenerate(false);
        }}
        autoRegenerate={debriefAutoRegenerate}
      />
    </div>
  );
}
