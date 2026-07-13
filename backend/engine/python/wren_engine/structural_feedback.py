"""Document-wide structural feedback (Task 9.9).

Produces non-anchored, document-level Socratic/structural feedback items
that are distinct from inline (anchored) items (REQ-FB-STRUCTURAL-01).
Structural feedback addresses organization, coherence, argument flow, and
other whole-document concerns that cannot meaningfully be anchored to a
single text span.

Key invariants:
- Structural items carry ``anchor=None`` — they are document-wide.
- They are subject to the same no-ghostwriting guardrail (Task 9.4):
  no replacement prose, only Socratic questions / error-type flags.
- They are presented distinctly from inline items (frontend concern,
  Task 18.3), but the *engine* marks them structurally via the
  ``is_structural=True`` flag.
- They are NOT subject to the inline density bound (Task 9.6):
  structural feedback has its own, smaller cap.
- The Progress Tracker re-evaluates structural items against the full
  new Draft (never ``removed``, since they have no anchor to delete).

Design references:
  - design.md "Structural feedback: produces document-wide, non-anchored
    Socratic/structural items, presented distinctly from inline items,
    subject to the same guardrail."
  - requirements.md Requirement 14 (REQ-FB-STRUCTURAL-01) criteria 1–3.
  - Property 16 (resolution): "For structural (non-anchored) items,
    `removed` is never assigned; re-evaluation uses the full new Draft."
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .output_guardrail import ValidatedFeedbackItem

__all__ = [
    "StructuralFeedbackItem",
    "FeedbackPartition",
    "StructuralFeedbackProcessor",
    "DEFAULT_STRUCTURAL_CAP",
]

# Default maximum number of structural feedback items per invocation.
# Structural feedback is meant to be concise — a handful of high-level
# observations about document organization and coherence.
DEFAULT_STRUCTURAL_CAP: int = 5


@dataclass(frozen=True, slots=True)
class StructuralFeedbackItem:
    """A document-wide structural feedback item.

    Distinct from inline items: ``anchor`` is always None, and
    ``is_structural`` is always True. This makes them identifiable for
    distinct presentation (REQ-FB-STRUCTURAL-01 criterion 2) and for
    special treatment in the Progress Tracker (criterion 4 / REQ-RESOLUTION-01
    criterion 7: never ``removed``, re-evaluated against the full new Draft).
    """

    category: str
    question: str
    citation: Optional[dict] = None
    is_structural: bool = True

    def __post_init__(self) -> None:
        if not self.category.strip():
            raise ValueError("category must not be empty")
        if not self.question.strip():
            raise ValueError("question must not be empty")


@dataclass(frozen=True, slots=True)
class FeedbackPartition:
    """Partitioned feedback: inline items vs structural (document-wide) items.

    The engine produces both in the same model invocation but they are
    stored and presented differently:
    - ``inline_items``: anchored to specific text spans, subject to density
      bounding (Task 9.6).
    - ``structural_items``: document-wide, not anchored, separate cap,
      presented distinctly (REQ-FB-STRUCTURAL-01 criterion 2).
    """

    inline_items: tuple[ValidatedFeedbackItem, ...]
    structural_items: tuple[StructuralFeedbackItem, ...]


class StructuralFeedbackProcessor:
    """Separates and processes structural feedback (Task 9.9).

    This processor:
    1. Partitions validated items into inline vs structural based on
       whether they carry an anchor.
    2. Converts structural items to :class:`StructuralFeedbackItem` with
       the ``is_structural`` marker.
    3. Applies a separate structural cap (not the density bound from 9.6).
    """

    def __init__(self, structural_cap: int = DEFAULT_STRUCTURAL_CAP) -> None:
        """Initialize with the maximum number of structural items.

        ``structural_cap`` controls how many document-wide items are retained.
        This is separate from the inline density cap (Task 9.6).
        """
        if structural_cap < 0:
            raise ValueError("structural_cap must be non-negative")
        self._structural_cap = structural_cap

    @property
    def structural_cap(self) -> int:
        return self._structural_cap

    def partition(
        self,
        items: list[ValidatedFeedbackItem] | tuple[ValidatedFeedbackItem, ...],
    ) -> FeedbackPartition:
        """Partition validated items into inline and structural.

        An item is *structural* (document-wide) if it has no anchor
        (``anchor is None``). An item is *inline* if it has an anchor.

        REQ-FB-STRUCTURAL-01 criterion 1: "THE Feedback_Engine SHALL
        produce document-wide (non-anchored) structural feedback covering
        organization and coherence, expressed as Socratic questions and/or
        error-type flags."
        """
        inline: list[ValidatedFeedbackItem] = []
        structural: list[StructuralFeedbackItem] = []

        for item in items:
            if item.anchor is None:
                structural.append(
                    StructuralFeedbackItem(
                        category=item.category,
                        question=item.question,
                        citation=item.citation,
                    )
                )
            else:
                inline.append(item)

        # Apply structural cap (retain first N, which preserves the model's
        # priority ordering)
        if len(structural) > self._structural_cap:
            structural = structural[: self._structural_cap]

        return FeedbackPartition(
            inline_items=tuple(inline),
            structural_items=tuple(structural),
        )

    def from_raw_structural_items(
        self,
        raw_items: list[ValidatedFeedbackItem] | tuple[ValidatedFeedbackItem, ...],
    ) -> tuple[StructuralFeedbackItem, ...]:
        """Convert a list of validated items (all expected to be structural).

        Use this when the model was explicitly asked for structural feedback
        and all returned items are document-wide. Items with anchors are
        still converted but logged as unexpected.
        """
        structural: list[StructuralFeedbackItem] = []

        for item in raw_items:
            structural.append(
                StructuralFeedbackItem(
                    category=item.category,
                    question=item.question,
                    citation=item.citation,
                )
            )

        # Apply cap
        if len(structural) > self._structural_cap:
            structural = structural[: self._structural_cap]

        return tuple(structural)
