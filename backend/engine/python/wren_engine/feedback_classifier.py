"""Taxonomy-bound classification and density bounding (Task 9.6).

Enforces two constraints on the validated Feedback Items produced by the
output guardrail (Task 9.4):

1. **Taxonomy-bound classification** (REQ-TAXONOMY-01 criterion 1,
   Property 14): every Feedback Item's ``category`` must belong to the
   active Document Type's configured error categories. Items with
   out-of-taxonomy categories are either remapped to the closest
   configured category (if unambiguous) or rejected.

2. **Density bounding** (REQ-FB-DENSITY-01, Property 13): the number of
   *inline* (anchored) Feedback Items scales with document length but is
   capped by the Document Type's configured density setting. When the cap
   binds, recurring patterns (items sharing the same category appearing
   multiple times) are prioritized over isolated one-off issues
   (REQ-FB-DENSITY-01 criterion 3).

These are pure, deterministic post-processing steps — no model calls. They
run after the output guardrail and before persistence.

Design references:
  - design.md "Density: number of inline items scales with document length,
    bounded by the Document-Type density setting; recurring patterns are
    prioritized when the density cap binds."
  - requirements.md Requirement 13 (REQ-FB-DENSITY-01) criteria 1–3.
  - requirements.md Requirement 15 (REQ-TAXONOMY-01) criterion 1.
  - Property 13: Annotation density bound.
  - Property 14: Classification stays within configured taxonomy.
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from .output_guardrail import ValidatedFeedbackItem

__all__ = [
    "DensitySetting",
    "ClassificationOutcome",
    "DensityOutcome",
    "FeedbackClassifier",
    "apply_raw_inline_density_cap",
    "compute_density_cap",
    "word_count_from_segments",
]


class DensitySetting(str, Enum):
    """Configurable density levels for inline feedback items.

    Maps to items-per-1000-words multipliers. A Department Admin
    configures this per Document Type (REQ-CONFIG-CONV-01).
    """

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# Density multipliers: inline items per 1000 words.
# These provide a reasonable range:
# - LOW: ~2 items/1000 words (light touch)
# - MEDIUM: ~4 items/1000 words (balanced)
# - HIGH: ~6 items/1000 words (detailed)
_DENSITY_MULTIPLIERS: dict[DensitySetting, float] = {
    DensitySetting.LOW: 2.0,
    DensitySetting.MEDIUM: 4.0,
    DensitySetting.HIGH: 6.0,
}

# Document-type config historically stores "moderate"; treat it as medium.
_DENSITY_ALIASES: dict[str, str] = {
    "moderate": "medium",
    "med": "medium",
}

# Minimum number of inline items regardless of document length,
# so very short documents still get at least some feedback.
_MINIMUM_INLINE_ITEMS: int = 1

# Maximum cap — no document gets more than this regardless of length.
_MAXIMUM_INLINE_ITEMS: int = 50


def compute_density_cap(
    word_count: int,
    density: DensitySetting | str,
    *,
    custom_items_per_1000: Optional[float] = None,
) -> int:
    """Compute the maximum number of inline items for a given document length.

    If ``custom_items_per_1000`` is provided, it overrides the enum-based
    multiplier (supports the ``items-per-N-words`` format from
    DocumentTypeConfig.density).

    The result is:
    - Non-decreasing in word_count for a fixed density (Property 13).
    - At least ``_MINIMUM_INLINE_ITEMS`` (even for very short docs).
    - At most ``_MAXIMUM_INLINE_ITEMS`` (sanity cap for very long docs).
    """
    if custom_items_per_1000 is not None:
        multiplier = custom_items_per_1000
    else:
        # Parse string density to enum if needed
        if isinstance(density, str):
            normalized = _DENSITY_ALIASES.get(density.lower(), density.lower())
            try:
                density = DensitySetting(normalized)
            except ValueError:
                # If the density string is a numeric "items-per-N-words" format,
                # e.g. "3.5" means 3.5 items per 1000 words
                try:
                    multiplier = float(normalized)
                except ValueError:
                    # Default to medium if unrecognizable
                    multiplier = _DENSITY_MULTIPLIERS[DensitySetting.MEDIUM]
                else:
                    pass  # multiplier already set from float parse
            else:
                multiplier = _DENSITY_MULTIPLIERS[density]
        else:
            multiplier = _DENSITY_MULTIPLIERS[density]

    raw = math.ceil((word_count / 1000.0) * multiplier)
    return max(_MINIMUM_INLINE_ITEMS, min(raw, _MAXIMUM_INLINE_ITEMS))


@dataclass(frozen=True, slots=True)
class ClassificationOutcome:
    """Result of taxonomy-bound classification filtering.

    ``accepted`` items have categories within the configured taxonomy.
    ``rejected`` items had out-of-taxonomy categories that could not be
    mapped to a configured category.
    """

    accepted: tuple[ValidatedFeedbackItem, ...]
    rejected: tuple[ValidatedFeedbackItem, ...]


@dataclass(frozen=True, slots=True)
class DensityOutcome:
    """Result of applying density bounds to inline items.

    ``retained`` items are within the density cap; ``trimmed`` items were
    dropped because the cap was exceeded. The selection prioritizes
    recurring patterns (REQ-FB-DENSITY-01 criterion 3).
    """

    retained: tuple[ValidatedFeedbackItem, ...]
    trimmed: tuple[ValidatedFeedbackItem, ...]
    cap: int


class FeedbackClassifier:
    """Taxonomy-bound classification and density bounding (Task 9.6).

    Pure logic — no I/O, no model calls. Operates on the output of
    :class:`OutputGuardrail` (Task 9.4).
    """

    def filter_by_taxonomy(
        self,
        items: list[ValidatedFeedbackItem] | tuple[ValidatedFeedbackItem, ...],
        configured_categories: tuple[str, ...] | list[str],
    ) -> ClassificationOutcome:
        """Filter items to only those with categories in the configured taxonomy.

        Category matching is case-insensitive (the model may produce slight
        variations in casing). If the configured taxonomy is empty, all items
        are accepted (a Document Type with no configured categories means
        the admin hasn't restricted the taxonomy yet — permissive default).

        REQ-TAXONOMY-01 criterion 1: "THE Feedback_Engine SHALL classify
        issues using the active Document Type's configured categories rather
        than a hardcoded enumeration."
        """
        if not configured_categories:
            # No taxonomy configured — permissive (accept all categories)
            return ClassificationOutcome(
                accepted=tuple(items),
                rejected=(),
            )

        # Build case-insensitive lookup
        normalized_categories = {c.lower().strip(): c for c in configured_categories}

        accepted: list[ValidatedFeedbackItem] = []
        rejected: list[ValidatedFeedbackItem] = []

        for item in items:
            item_category_lower = item.category.lower().strip()
            if item_category_lower in normalized_categories:
                # Re-normalize to the configured category name (canonical casing)
                canonical = normalized_categories[item_category_lower]
                if canonical != item.category:
                    # Replace with canonical casing
                    item = ValidatedFeedbackItem(
                        category=canonical,
                        question=item.question,
                        anchor=item.anchor,
                        citation=item.citation,
                    )
                accepted.append(item)
            else:
                rejected.append(item)

        return ClassificationOutcome(
            accepted=tuple(accepted),
            rejected=tuple(rejected),
        )

    def apply_density_bound(
        self,
        inline_items: list[ValidatedFeedbackItem] | tuple[ValidatedFeedbackItem, ...],
        word_count: int,
        density: str,
        *,
        custom_items_per_1000: Optional[float] = None,
    ) -> DensityOutcome:
        """Apply the density cap to inline (anchored) items.

        When the cap binds, items are prioritized by:
        1. Recurring patterns first: categories that appear multiple times
           are prioritized over one-off categories (REQ-FB-DENSITY-01
           criterion 3).
        2. Within the same frequency tier, original order is preserved
           (the model's own priority ordering).

        Non-anchored (structural) items are NOT subject to this density
        bound — they are handled separately (Task 9.9).
        """
        cap = compute_density_cap(
            word_count, density, custom_items_per_1000=custom_items_per_1000
        )

        items_list = list(inline_items)

        if len(items_list) <= cap:
            return DensityOutcome(
                retained=tuple(items_list),
                trimmed=(),
                cap=cap,
            )

        # Prioritize recurring patterns
        prioritized = self._prioritize_by_recurrence(items_list, cap)

        retained = prioritized[:cap]
        # Use id-based comparison since items may contain unhashable dicts
        retained_ids = {id(item) for item in retained}
        trimmed = [item for item in items_list if id(item) not in retained_ids]

        return DensityOutcome(
            retained=tuple(retained),
            trimmed=tuple(trimmed),
            cap=cap,
        )

    def _prioritize_by_recurrence(
        self,
        items: list[ValidatedFeedbackItem],
        cap: int,
    ) -> list[ValidatedFeedbackItem]:
        """Prioritize items by category recurrence, then original order.

        Strategy: count how many items share each category, then sort items
        by descending frequency of their category. Within the same frequency,
        preserve original model output order. This ensures recurring patterns
        (same category appearing in multiple places) are retained when the
        cap forces trimming.
        """
        # Count occurrences of each category
        category_counts: Counter[str] = Counter(item.category for item in items)

        # Build (frequency, original_index, item) tuples for stable sorting
        scored: list[tuple[int, int, ValidatedFeedbackItem]] = [
            (category_counts[item.category], idx, item)
            for idx, item in enumerate(items)
        ]

        # Sort by descending frequency, then ascending original index
        scored.sort(key=lambda x: (-x[0], x[1]))

        return [item for _, _, item in scored]


def word_count_from_segments(segments: list[dict[str, Any]]) -> int:
    """Count whitespace-delimited words across draft segments."""
    total = 0
    for segment in segments:
        text = segment.get("text") or ""
        if isinstance(text, str) and text.strip():
            total += len(text.split())
    return total


def apply_raw_inline_density_cap(
    items: list[dict[str, Any]],
    *,
    word_count: int,
    density: str,
) -> list[dict[str, Any]]:
    """Trim ``kind=inline`` engine items to the density cap; leave others.

    Operates on the raw Bedrock JSON dicts used by ``handler.py`` so the live
    job path can apply Task 9.6 without converting the whole batch.
    """
    inline_items = [item for item in items if item.get("kind") == "inline"]
    if not inline_items:
        return items

    wrappers = [
        ValidatedFeedbackItem(
            category=str(item.get("error_category_id") or ""),
            question=str(item.get("question_text") or ""),
        )
        for item in inline_items
    ]
    outcome = FeedbackClassifier().apply_density_bound(wrappers, word_count, density)
    if not outcome.trimmed:
        return items

    retained_wrapper_ids = {id(wrapper) for wrapper in outcome.retained}
    retained_inline_ids = {
        id(item)
        for wrapper, item in zip(wrappers, inline_items)
        if id(wrapper) in retained_wrapper_ids
    }
    return [
        item
        for item in items
        if item.get("kind") != "inline" or id(item) in retained_inline_ids
    ]
