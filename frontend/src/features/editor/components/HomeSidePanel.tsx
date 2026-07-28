/**
 * Home side panel — compact metadata, scrollable outline, actionable Revise CTA.
 * Layout: sticky metadata + footer; Contents grows and scrolls independently.
 */
import { CircleHelp, FileText, ListTree, Sparkles, Upload } from 'lucide-react';

import { appConfig } from '@/config/env';

import { DocumentTableOfContents } from './DocumentTableOfContents';

import type { TableOfContentData } from '@tiptap/extension-table-of-contents';

export interface HomeSidePanelProps {
  readonly draftVersion: number;
  readonly wordCount: number;
  readonly anchors: TableOfContentData;
  readonly onOpenDebrief: () => void;
  readonly onUpload: () => void;
  readonly uploadPending?: boolean;
  readonly errorMessage?: string;
}

export function HomeSidePanel({
  draftVersion,
  wordCount,
  anchors,
  onOpenDebrief,
  onUpload,
  uploadPending = false,
  errorMessage,
}: HomeSidePanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Compact metadata — not boxed cards */}
      <header className="shrink-0 border-b border-border-subtle px-lg py-md">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <p className="flex items-center gap-xs text-caption font-sans font-semibold uppercase tracking-wide text-text-muted">
              <FileText size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              Draft
            </p>
            <p className="mt-xs truncate text-bodySmall font-sans text-text-primary">
              <span className="font-semibold">v{draftVersion}</span>
              <span className="text-text-muted" aria-hidden="true">
                {' '}
                ·{' '}
              </span>
              <span className="text-text-secondary">{wordCount.toLocaleString()} words</span>
            </p>
          </div>
          <span
            className="inline-flex shrink-0 rounded-sm p-xs text-text-muted hover:bg-surface-muted hover:text-text-secondary focus-within:outline focus-within:outline-2 focus-within:outline-border-strong"
            title={`Use the left rail for Ask ${appConfig.appName}, AI Debrief, upload, and download.`}
          >
            <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">
              Use the left rail for Ask {appConfig.appName}, AI Debrief, upload, and download.
            </span>
          </span>
        </div>
      </header>

      {/* Contents fills remaining height and scrolls */}
      <section className="flex min-h-0 flex-1 flex-col px-lg pt-md" aria-labelledby="home-contents-heading">
        <div className="mb-sm flex shrink-0 items-center gap-xs">
          <ListTree size={12} strokeWidth={2} aria-hidden="true" className="text-text-muted" />
          <h2
            id="home-contents-heading"
            className="text-caption font-sans font-semibold uppercase tracking-wide text-text-muted"
          >
            Contents
          </h2>
        </div>
        <DocumentTableOfContents anchors={anchors} className="min-h-0 flex-1" />
      </section>

      {/* Sticky Revise CTA */}
      <footer className="shrink-0 border-t border-border-subtle px-lg py-md">
        <p className="mb-sm flex items-center gap-xs text-caption font-sans font-semibold uppercase tracking-wide text-text-muted">
          <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
          Revise
        </p>
        <button
          type="button"
          onClick={onOpenDebrief}
          className="flex w-full items-center justify-center gap-sm rounded-md bg-accent-primary px-md py-sm text-bodySmall font-sans font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
        >
          <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
          Open AI Debrief
        </button>
        <button
          type="button"
          onClick={onUpload}
          disabled={uploadPending}
          className="mt-sm inline-flex w-full items-center justify-center gap-xs rounded-sm px-sm py-xs text-caption font-sans font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
          {uploadPending ? 'Uploading…' : 'Upload a new file'}
        </button>
        {errorMessage ? (
          <p role="alert" className="mt-sm text-caption text-signal-critical">
            {errorMessage}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
