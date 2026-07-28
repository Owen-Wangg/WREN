/**
 * Contents side panel — document outline only (H1–H3 via TipTap TOC).
 */
import { ListTree } from 'lucide-react';

import { DocumentTableOfContents } from './DocumentTableOfContents';

import type { TableOfContentData } from '@tiptap/extension-table-of-contents';

export interface HomeSidePanelProps {
  readonly anchors: TableOfContentData;
}

export function HomeSidePanel({ anchors }: HomeSidePanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col px-lg py-md">
      <div className="mb-sm flex shrink-0 items-center gap-xs">
        <ListTree size={12} strokeWidth={2} aria-hidden="true" className="text-text-muted" />
        <h2 className="text-caption font-sans font-semibold uppercase tracking-wide text-text-muted">
          Contents
        </h2>
      </div>
      <DocumentTableOfContents anchors={anchors} className="min-h-0 flex-1" />
    </div>
  );
}
