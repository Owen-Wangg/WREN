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
  /** Extra classes on the root nav (e.g. flex-1 for panel fill). */
  readonly className?: string;
}

export function DocumentTableOfContents({ anchors, className }: DocumentTableOfContentsProps) {
  const headings = anchors.filter(
    (item) => item.originalLevel >= 1 && item.originalLevel <= MAX_HEADING_LEVEL,
  );

  return (
    <nav
      aria-label="Table of contents"
      className={['flex min-h-0 flex-col', className].filter(Boolean).join(' ')}
    >
      {headings.length === 0 ? (
        <p className="text-caption font-sans text-text-muted leading-snug">
          Add Heading 1–3 to build an outline.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-md">
          {headings.map((item) => {
            const indent = Math.max(0, item.originalLevel - 1);
            const isH1 = item.originalLevel === 1;
            return (
              <li key={item.id} style={{ paddingLeft: `${indent * 0.7}rem` }}>
                <button
                  type="button"
                  onClick={() => scrollToHeading(item)}
                  aria-current={item.isActive ? 'location' : undefined}
                  className={[
                    'group relative w-full rounded-sm px-sm py-xs text-left font-sans leading-snug transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong',
                    'hover:bg-surface-muted',
                    isH1 ? 'text-bodySmall' : 'text-caption',
                    item.isActive
                      ? 'bg-surface-muted font-medium text-text-primary'
                      : isH1
                        ? 'font-medium text-text-primary'
                        : 'text-text-secondary hover:text-text-primary',
                  ].join(' ')}
                >
                  {item.isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-[60%] w-[2px] -translate-y-1/2 rounded-full bg-accent-primary"
                    />
                  )}
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
