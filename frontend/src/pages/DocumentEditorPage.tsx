import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

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
};

export function DocumentEditorPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const envId = documentId ?? 'doc-1';
  const documentName =
    (location.state as { documentName?: string } | null)?.documentName ??
    'Untitled Document';

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="shrink-0 px-lg pt-md">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-sm text-bodySmall font-sans text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden="true">&larr;</span> Back to Dashboard
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-lg px-lg pb-lg pt-md">
        {/* Left sidebar: document name + action buttons (bottom-aligned) */}
        <aside className="flex w-[240px] shrink-0 flex-col">
          <h2 className="text-heading2 font-sans font-bold text-text-primary">
            {documentName}
          </h2>

          <hr className="my-md border-border-subtle" />

          <nav className="mt-auto flex flex-col gap-sm" aria-label="Document actions">
            <button
              type="button"
              onClick={() => setDebriefOpen(true)}
              className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
            >
              View AI Debrief
            </button>
            <button
              type="button"
              onClick={() => setDebriefOpen(true)}
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
            <button
              type="button"
              className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
            >
              Download Document
            </button>
            <button
              type="button"
              className="w-full rounded-md bg-accent-primary px-lg py-sm text-bodySmall font-sans font-semibold text-text-on-accent"
            >
              Re-Upload Document
            </button>
          </nav>
        </aside>

        {/* Main editor area — scrolls internally */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-subtle">
          <AnchoredFeedbackEditorContainer
            environmentId={envId}
            ariaLabel="Draft editor"
            initialContent={previewEditorContent}
            categoryLabels={previewCategoryLabels}
          />
        </div>

        {/* Collapsible resizable right sidebar: Ask chat panel */}
        {chatOpen && (
          <div className="relative flex min-h-0 w-80 min-w-64 max-w-lg shrink-0 resize-x overflow-hidden">
            <WrenChatPanel
              documentId={envId}
              draftId="draft-1"
              draftVersion={1}
              askWrenService={askWrenService}
              className="h-full w-full"
            />
          </div>
        )}
      </div>

      <AiDebriefModal
        environmentId={envId}
        open={debriefOpen}
        onOpenChange={setDebriefOpen}
      />
    </div>
  );
}
