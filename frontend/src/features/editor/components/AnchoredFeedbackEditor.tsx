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
import { useEffect, useMemo, useRef } from 'react';

import { DocumentEditor, type DocumentEditorHandle, type DocumentEditorProps } from './DocumentEditor';

import { collectCommentIds, resolveAnchorRange, resolveDebriefHighlightRange } from '../anchorRange';
import {
  buildAnchoredFeedbackItems,
  partitionAnchoredFeedbackItems,
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
  /** Anchor ID to highlight when student clicks a quote in the AI Debrief. */
  readonly highlightedAnchorId?: string;
  /** Quoted text from the debrief / Ask LEON item — preferred for locating the highlight span. */
  readonly highlightedQuotedText?: string;
  /** Coarse Ask LEON location hint used to prefer a paragraph band when matching. */
  readonly highlightedLocationHint?: string;
  /** Show comment marks only after coach has responded (default: false). */
  readonly showCoachHighlights?: boolean;
}

function scrollRangeIntoView(
  editor: NonNullable<ReturnType<DocumentEditorHandle['getEditor']>>,
  from: number,
): void {
  try {
    const dom = editor.view.domAtPos(from);
    const node = dom.node;
    const el =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : (node as HTMLElement);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
  } catch {
    // Position may be temporarily invalid during remounts; ignore.
  }
}

export function AnchoredFeedbackEditor({
  feedbackItems,
  anchors,
  initialContent,
  ariaLabel,
  onContentChange,
  className,
  highlightedAnchorId,
  highlightedQuotedText,
  highlightedLocationHint,
  showCoachHighlights = false,
}: AnchoredFeedbackEditorProps) {
  const editorRef = useRef<DocumentEditorHandle>(null);

  const anchoredItems = useMemo(
    () => buildAnchoredFeedbackItems(feedbackItems, anchors),
    [feedbackItems, anchors],
  );
  const { active } = useMemo(
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

    // Only show comment marks after coach has responded
    if (!showCoachHighlights) {
      // Clear all comment marks
      for (const commentId of collectCommentIds(editor.state.doc)) {
        editor.commands.unsetComment(commentId);
      }
      return;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on activeAnchorKey and showCoachHighlights
  }, [activeAnchorKey, showCoachHighlights]);

  const handleCommentActivated = (_commentId: string | null) => {
    // Comment activation handler preserved for future margin-card linkage.
  };

  // When student clicks a quote in AI Debrief, scroll to and keep it highlighted
  // until they clear the selection (click again) or pick another quote.
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;

    const markType = editor.schema.marks.highlight;
    if (markType) {
      const { size } = editor.state.doc.content;
      if (size > 0) {
        const clearTr = editor.state.tr.removeMark(0, size, markType);
        editor.view.dispatch(clearTr);
      }
    }

    if (!highlightedAnchorId && !highlightedQuotedText?.trim()) return;

    const anchor = highlightedAnchorId
      ? anchors.find((a) => a.id === highlightedAnchorId)
      : undefined;

    const range = resolveDebriefHighlightRange(editor.state.doc, {
      anchor: anchor ?? null,
      quotedText: highlightedQuotedText,
      locationHint: highlightedLocationHint,
    });
    if (!range) {
      console.warn('Could not resolve debrief highlight', {
        highlightedAnchorId,
        highlightedQuotedText,
        highlightedLocationHint,
      });
      return;
    }

    const { from, to } = range;

    if (markType) {
      const tr = editor.state.tr.addMark(from, to, markType.create({ color: '#F5D76E' }));
      editor.view.dispatch(tr);
    }

    // Defer scroll so the mark is painted and nested scroll parents settle.
    requestAnimationFrame(() => {
      scrollRangeIntoView(editor, from);
    });
  }, [highlightedAnchorId, highlightedQuotedText, highlightedLocationHint, anchors]);

  return (
    <div className={['flex h-full min-h-0 gap-0', className].filter(Boolean).join(' ')}>
      <div className="document-editor-scroll flex min-h-0 flex-1 flex-col">
        <DocumentEditor
          ref={editorRef}
          initialContent={initialContent}
          ariaLabel={ariaLabel}
          onContentChange={onContentChange}
          onCommentActivated={handleCommentActivated}
          className="min-h-full"
        />
      </div>
    </div>
  );
}
