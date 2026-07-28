/**
 * Outline list for the Home panel, driven by TipTap
 * `@tiptap/extension-table-of-contents` anchors (H1–H3).
 */
import type { TableOfContentData, TableOfContentDataItem } from '@tiptap/extension-table-of-contents';

const MAX_HEADING_LEVEL = 3;

function scrollToHeading(item: TableOfContentDataItem): void {
  const el = item.dom;
  if (el) {
    el.scrollIntoView({ block: 'start', behavior: 'smooth', inline: 'nearest' });
    el.classList.add('document-toc-flash');
    window.setTimeout(() => el.classList.remove('document-toc-flash'), 1200);
    return;
  }
  try {
    item.editor.chain().focus().setTextSelection(item.pos).scrollIntoView().run();
  } catch {
    // Position may be stale during remounts.
  }
}

export interface DocumentTableOfContentsProps {
  readonly anchors: TableOfContentData;
}

export function DocumentTableOfContents({ anchors }: DocumentTableOfContentsProps) {
  const headings = anchors.filter(
    (item) => item.originalLevel >= 1 && item.originalLevel <= MAX_HEADING_LEVEL,
  );

  return (
    <nav aria-label="Table of contents" className="flex min-h-0 flex-col gap-sm">
      <p className="text-caption font-sans font-semibold uppercase tracking-wide text-text-muted">
        Contents
      </p>
      {headings.length === 0 ? (
        <p className="text-caption text-text-muted leading-relaxed">
          Add Heading 1–3 in the document to build an outline.
        </p>
      ) : (
        <ul className="flex flex-col gap-xs overflow-y-auto">
          {headings.map((item) => {
            const indent = Math.max(0, item.originalLevel - 1);
            return (
              <li key={item.id} style={{ paddingLeft: `${indent * 0.75}rem` }}>
                <button
                  type="button"
                  onClick={() => scrollToHeading(item)}
                  className={[
                    'w-full rounded-sm px-sm py-xs text-left text-caption font-sans leading-snug transition-colors',
                    'hover:bg-surface-muted hover:text-text-primary',
                    item.isActive
                      ? 'bg-accent-primary/10 font-medium text-accent-primary'
                      : 'text-text-secondary',
                  ].join(' ')}
                >
                  <span className="line-clamp-2">{item.textContent || 'Untitled'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
