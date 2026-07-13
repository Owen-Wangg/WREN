/**
 * Feedback Item ↔ Anchor joining logic (task 18.2; Requirements 11.2, 12.1,
 * 12.2, 12.3, 12.4).
 *
 * `FeedbackItem` and `Anchor` (`@wren/types`) are separate entities linked by
 * `FeedbackItem.currentAnchorId`. This module is the single place that joins
 * them into an {@link AnchoredFeedbackItem} view model and partitions the
 * result into "active" (render as a margin comment on its span) vs. "removed"
 * (render in the non-anchored "no longer applies" state — Requirement 12.4 /
 * REQ-ANCHOR-01) without ever silently dropping an item either way.
 *
 * Only `kind === 'inline'` Feedback Items are in scope here — document-wide
 * `structural` items have no Anchor and are rendered by the AI Debrief view
 * (task 18.3's `FeedbackItemsList`), not the editor's margin-comments layer.
 */
import type { Anchor, FeedbackItem } from '@wren/types';

/** A `FeedbackItem` joined with its current `Anchor`, if any. */
export interface AnchoredFeedbackItem {
  readonly feedbackItem: FeedbackItem;
  /**
   * `null` when the item has no `currentAnchorId`, or the referenced Anchor
   * wasn't supplied — treated identically to a `removed` anchor (Requirement
   * 12.4: never attach to unrelated text, never silently drop the item).
   */
  readonly anchor: Anchor | null;
}

/** Joins inline Feedback Items with their current Anchor by id. */
export function buildAnchoredFeedbackItems(
  feedbackItems: readonly FeedbackItem[],
  anchors: readonly Anchor[],
): readonly AnchoredFeedbackItem[] {
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor] as const));

  return feedbackItems
    .filter((feedbackItem) => feedbackItem.kind === 'inline')
    .map((feedbackItem) => ({
      feedbackItem,
      anchor: feedbackItem.currentAnchorId
        ? anchorById.get(feedbackItem.currentAnchorId) ?? null
        : null,
    }));
}

/** True when an item has a live, attachable Anchor (Requirement 12.1). */
export function hasActiveAnchor(
  item: AnchoredFeedbackItem,
): item is AnchoredFeedbackItem & { anchor: Anchor } {
  return item.anchor !== null && item.anchor.state === 'active';
}

export interface PartitionedFeedbackItems {
  /** Attach a margin comment to the corresponding span. */
  readonly active: readonly (AnchoredFeedbackItem & { anchor: Anchor })[];
  /** Render as "no longer applies" — never attached to unrelated text. */
  readonly removed: readonly AnchoredFeedbackItem[];
}

/** Splits joined items into "active" (anchored) vs. "removed" (non-anchored). */
export function partitionAnchoredFeedbackItems(
  items: readonly AnchoredFeedbackItem[],
): PartitionedFeedbackItems {
  const active: (AnchoredFeedbackItem & { anchor: Anchor })[] = [];
  const removed: AnchoredFeedbackItem[] = [];

  for (const item of items) {
    if (hasActiveAnchor(item)) {
      active.push(item);
    } else {
      removed.push(item);
    }
  }

  return { active, removed };
}

/** Resolves a human-readable category label, falling back to the raw id when
 * the caller hasn't resolved Config Service category labels yet (task 18.2
 * scope note: "accept a resolved category label as a prop rather than
 * resolving IDs yourself, since Config Service isn't built yet"). */
export function resolveCategoryLabel(
  errorCategoryId: string,
  categoryLabels: Readonly<Record<string, string>> | undefined,
): string {
  return categoryLabels?.[errorCategoryId] ?? errorCategoryId;
}
