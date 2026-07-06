/**
 * `<AnchoredFeedbackEditor>` — renders inline anchored feedback through
 * `<DocumentEditor>`'s comments/tracked-changes layer (task 18.2;
 * Requirements 11.2, 12.1, 12.2, 12.3, 12.4).
 *
 * Composes, but does not replace, the task-18.1 `<DocumentEditor>`:
 *  - Attaches a comment mark to each active Anchor's span via
 *    `editor.commands.setComment(feedbackItemId)` (Requirement 12.1),
 *    resolving spans with `resolveAnchorRange` (`../anchorRange`).
 *  - Renders a margin/sidebar list of `<MarginCommentCard>`s, one per inline
 *    Feedback Item, each showing its category label + Socratic question
 *    (Requirement 12.3).
 *  - Implements the select-item ↔ highlight-span linkage (Requirement 12.2):
 *    clicking a margin card selects/scrolls-to its span in the editor;
 *    activating a comment mark in the editor (via `onCommentActivated`)
 *    selects the corresponding margin card.
 *  - Renders items whose anchor is `removed` (or missing) in a distinct
 *    "no longer applies" section — never attached to unrelated text, never
 *    silently dropped from the list (Requirement 12.4).
 *
 * The comment id used with `setComment`/`unsetComment` IS the Feedback Item's
 * id — this is what makes `onCommentActivated`'s `commentId` directly usable
 * as the margin-card selection key, with no separate lookup table needed.
 *
 * **No-ghostwriting compliance:** every margin card and every comment-mark
 * span carries `data-ai-feedback="true"` (see `DocumentEditor` and
 * `MarginCommentCard`) and NEITHER renders any Apply/Insert/Accept
 * affordance — this component only ever reads Feedback Items, it never
 * writes generated text into the editor's content.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { DocumentEditor, type DocumentEditorHandle, type DocumentEditorProps } from './DocumentEditor';
import { MarginCommentCard } from './MarginCommentCard';

import { collectCommentIds, resolveAnchorRange } from '../anchorRange';
import {
  buildAnchoredFeedbackItems,
  partitionAnchoredFeedbackItems,
  resolveCategoryLabel,
} from '../feedbackAnchoring';

import type { Anchor, FeedbackItem } from '@wren/types';

export interface AnchoredFeedbackEditorProps
  extends Pick<DocumentEditorProps, 'initialContent' | 'ariaLabel' | 'onContentChange' | 'className'> {
  /** Inline + structural Feedback Items for the current draft; only `kind === 'inline'` items render here. */
  readonly feedbackItems: readonly FeedbackItem[];
  /** Anchors for the current draft, referenced by `FeedbackItem.currentAnchorId`. */
  readonly anchors: readonly Anchor[];
  /**
   * Resolved `errorCategoryId` → display label. Config Service isn't built
   * yet (task 18.2 scope note), so callers pass a resolved map; unresolved
   * ids fall back to the raw id via `resolveCategoryLabel`.
   */
  readonly categoryLabels?: Readonly<Record<string, string>>;
}

export function AnchoredFeedbackEditor({
  feedbackItems,
  anchors,
  categoryLabels,
  initialContent,
  ariaLabel,
  onContentChange,
  className,
}: AnchoredFeedbackEditorProps) {
  const editorRef = useRef<DocumentEditorHandle>(null);
  const [selectedFeedbackItemId, setSelectedFeedbackItemId] = useState<string | null>(null);

  const anchoredItems = useMemo(
    () => buildAnchoredFeedbackItems(feedbackItems, anchors),
    [feedbackItems, anchors],
  );
  const { active, removed } = useMemo(
    () => partitionAnchoredFeedbackItems(anchoredItems),
    [anchoredItems],
  );

  // Attach a comment mark to each active anchor's span (Requirement 12.1).
  // Keyed on the active set's identity-relevant fields (not on every
  // keystroke) so re-running doesn't fight the writer's own selection while
  // they type; the editor's document content is otherwise unaffected by this
  // effect (marks only, no text insertion — no-ghostwriting compliance).
  const activeAnchorKey = useMemo(
    () =>
      active
        .map(
          ({ feedbackItem, anchor }) =>
            `${feedbackItem.id}:${anchor.paragraphIndex}:${anchor.startOffset}:${anchor.endOffset}`,
        )
        .join('|'),
    [active],
  );

  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;

    // Unset any comment mark that no longer corresponds to an active anchor
    // (e.g. its anchor was just marked `removed`) before re-attaching the
    // current set, so stale marks never linger on text.
    const activeIds = new Set(active.map(({ feedbackItem }) => feedbackItem.id));
    for (const commentId of collectCommentIds(editor.state.doc)) {
      if (!activeIds.has(commentId)) {
        editor.commands.unsetComment(commentId);
      }
    }

    for (const { feedbackItem, anchor } of active) {
      const range = resolveAnchorRange(editor.state.doc, anchor);
      if (!range) continue;

      editor.chain().setTextSelection(range).setComment(feedbackItem.id).run();
    }
    // Restore an empty/collapsed selection so attaching marks doesn't leave
    // the writer's cursor jumped to the last-attached span.
    editor.commands.setTextSelection(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on activeAnchorKey, not `active` identity
  }, [activeAnchorKey]);

  /** Select-item → highlight-span: clicking a margin card scrolls to/highlights its span. */
  const handleSelectFromMargin = (feedbackItemId: string) => {
    setSelectedFeedbackItemId(feedbackItemId);

    const editor = editorRef.current?.getEditor();
    if (!editor) return;

    const activeItem = active.find(({ feedbackItem }) => feedbackItem.id === feedbackItemId);
    if (!activeItem) return;

    const range = resolveAnchorRange(editor.state.doc, activeItem.anchor);
    if (!range) return;

    editor.chain().setTextSelection(range).scrollIntoView().run();
  };

  /** Highlight-span → select-item: activating a comment mark in the editor selects the margin card. */
  const handleCommentActivated = (commentId: string | null) => {
    setSelectedFeedbackItemId(commentId);
  };

  return (
    <div className={['flex min-h-[600px] gap-0', className].filter(Boolean).join(' ')}>
      {/* Left sidebar — 240px, #F2F2F2 fill */}
      <aside
        aria-label="Editor tools"
        className="flex w-[240px] shrink-0 flex-col gap-md bg-surface-subtle p-lg"
      >
        <h2 className="text-heading2 font-sans font-semibold text-text-primary">
          Document
        </h2>
        <hr className="border-border-subtle" />
        <div className="flex flex-col gap-sm">
          <button
            type="button"
            className="h-[48px] w-[220px] rounded-md bg-accent-primary text-body font-sans font-semibold text-text-on-accent shadow-md"
          >
            View AI Debrief
          </button>
          <button
            type="button"
            className="h-[48px] w-[220px] rounded-md bg-accent-primary text-body font-sans font-semibold text-text-on-accent shadow-md"
          >
            Regenerate AI Debrief
          </button>
          <button
            type="button"
            className="h-[48px] w-[220px] rounded-md bg-accent-primary text-body font-sans font-semibold text-text-on-accent shadow-md"
          >
            Ask WREN
          </button>
          <button
            type="button"
            className="h-[48px] w-[220px] rounded-md bg-accent-primary text-body font-sans font-semibold text-text-on-accent shadow-md"
          >
            Download Document
          </button>
          <button
            type="button"
            className="h-[48px] w-[220px] rounded-md bg-accent-primary text-body font-sans font-semibold text-text-on-accent shadow-md"
          >
            Re-Upload Document
          </button>
        </div>
      </aside>

      {/* Main editor area */}
      <div className="flex flex-1 flex-col">
        <DocumentEditor
          ref={editorRef}
          initialContent={initialContent}
          ariaLabel={ariaLabel}
          onContentChange={onContentChange}
          onCommentActivated={handleCommentActivated}
          className="flex-1"
        />
      </div>

      {/* Right panel — 320px with margin comments */}
      <aside
        aria-label="Feedback comments"
        className="flex w-[320px] shrink-0 flex-col gap-md bg-surface-panel p-lg"
      >
        <h3 className="text-heading3 font-sans font-semibold text-text-primary">
          LLM Feedback
        </h3>

        <ul aria-label="Anchored feedback" className="flex flex-1 flex-col gap-sm overflow-y-auto">
          {active.length === 0 && removed.length === 0 && (
            <p className="text-bodySmall text-text-muted">
              No inline feedback for this draft.
            </p>
          )}
          {active.map((item) => (
            <MarginCommentCard
              key={item.feedbackItem.id}
              item={item}
              categoryLabel={resolveCategoryLabel(item.feedbackItem.errorCategoryId, categoryLabels)}
              isSelected={selectedFeedbackItemId === item.feedbackItem.id}
              isRemoved={false}
              onSelect={handleSelectFromMargin}
            />
          ))}
        </ul>

        {removed.length > 0 && (
          <section aria-labelledby="removed-feedback-heading" className="border-t border-border-subtle pt-md">
            <h3
              id="removed-feedback-heading"
              className="mb-sm text-caption font-sans font-semibold uppercase text-text-muted"
            >
              No longer applies
            </h3>
            <ul aria-label="Feedback no longer anchored to this draft" className="flex flex-col gap-sm">
              {removed.map((item) => (
                <MarginCommentCard
                  key={item.feedbackItem.id}
                  item={item}
                  categoryLabel={resolveCategoryLabel(item.feedbackItem.errorCategoryId, categoryLabels)}
                  isSelected={false}
                  isRemoved
                  onSelect={handleSelectFromMargin}
                />
              ))}
            </ul>
          </section>
        )}

        {/* Ask WREN input at bottom (Figma: 8px radius, 1px border, 14px placeholder at 50%) */}
        <div className="mt-auto">
          <div
            className="w-full rounded-md border border-border-subtle bg-surface-primary px-md py-sm text-bodySmall text-text-primary/50"
            aria-hidden="true"
          >
            Ask WREN about this draft…
          </div>
        </div>
      </aside>
    </div>
  );
}
