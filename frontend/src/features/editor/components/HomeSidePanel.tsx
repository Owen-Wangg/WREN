/**
 * Contents side panel — document title/meta + outline (H1–H3 via TipTap TOC).
 */
import { ListTree } from 'lucide-react';

import { DocumentTableOfContents } from './DocumentTableOfContents';

import type { TableOfContentData } from '@tiptap/extension-table-of-contents';

export interface HomeSidePanelProps {
  readonly anchors: TableOfContentData;
  /** Document display name shown above the outline. */
  readonly documentTitle: string;
  /** Muted line under the title, e.g. "Draft v1 · 246 words · 3 pages". */
  readonly documentMeta: string;
}

export function HomeSidePanel({
  anchors,
  documentTitle,
  documentMeta,
}: HomeSidePanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border-subtle px-lg pb-md pt-md">
        <h1
          className="truncate text-body font-sans font-semibold leading-snug text-text-primary"
          title={documentTitle}
        >
          {documentTitle}
        </h1>
        <p
          className="mt-xs truncate text-caption font-sans leading-snug text-text-muted"
          title={documentMeta}
        >
          {documentMeta}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-lg py-md">
        <div className="mb-sm flex shrink-0 items-center gap-xs">
          <ListTree size={12} strokeWidth={2} aria-hidden="true" className="text-text-muted" />
          <h2 className="text-caption font-sans font-semibold uppercase tracking-wide text-text-muted">
            Contents
          </h2>
        </div>
        <DocumentTableOfContents anchors={anchors} className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
