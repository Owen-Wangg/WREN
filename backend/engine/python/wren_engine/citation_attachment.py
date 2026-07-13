"""Citation attachment (Task 10.3).

Attaches source-identity citations to Feedback Items when specific
Reference Material informed the feedback. Citations identify the source
(title/section) without reproducing replacement prose.

Key invariants:
- A citation is attached ONLY when specific material informed the item.
- A citation contains only source identity: title and optional section/page.
- A citation NEVER contains replacement prose or a corrected version.
- No citation is attached when no reference material informed the item
  (Requirement 21.4).

Design references:
  - design.md Section 10.3: "Attach a source-identity citation (title/section)
    when specific material informed an item; never reproduce replacement
    prose; no citation when none informed it."
  - requirements.md Requirement 21 (REQ-REFMAT-CITE-01) criteria 21.1–21.4.
  - Property 20: Feedback citation presence and content.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .output_guardrail import ValidatedFeedbackItem
from .reference_store import RetrievalResult
from .structural_feedback import StructuralFeedbackItem

__all__ = [
    "Citation",
    "CitedFeedbackItem",
    "CitedStructuralItem",
    "CitationAttacher",
    "RELEVANCE_THRESHOLD",
]

# Minimum similarity score for a retrieval result to be considered
# "informing" a feedback item. Below this threshold, the reference
# material did not meaningfully contribute and no citation is attached.
RELEVANCE_THRESHOLD: float = 0.65


@dataclass(frozen=True, slots=True)
class Citation:
    """A source-identity citation for a Feedback Item.

    Contains ONLY identifying information (title + optional section).
    Never contains the referenced text content itself or any replacement
    prose (REQ-REFMAT-CITE-01 criterion 21.2, REQ-CORE-NOGHOST-01).
    """

    title: str
    section: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.title.strip():
            raise ValueError("citation title must not be empty")

    def to_dict(self) -> dict[str, str]:
        """Serialize to the dict format used in ValidatedFeedbackItem.citation."""
        result: dict[str, str] = {"title": self.title}
        if self.section:
            result["section"] = self.section
        return result


@dataclass(frozen=True, slots=True)
class CitedFeedbackItem:
    """An inline feedback item with an attached citation (or None).

    Wraps ValidatedFeedbackItem with a resolved citation based on
    reference material retrieval results.
    """

    item: ValidatedFeedbackItem
    citation: Optional[Citation]

    @property
    def has_citation(self) -> bool:
        return self.citation is not None

    def to_validated_item(self) -> ValidatedFeedbackItem:
        """Convert back to a ValidatedFeedbackItem with citation dict."""
        citation_dict = self.citation.to_dict() if self.citation else None
        return ValidatedFeedbackItem(
            category=self.item.category,
            question=self.item.question,
            anchor=self.item.anchor,
            citation=citation_dict,
        )


@dataclass(frozen=True, slots=True)
class CitedStructuralItem:
    """A structural feedback item with an attached citation (or None)."""

    item: StructuralFeedbackItem
    citation: Optional[Citation]

    @property
    def has_citation(self) -> bool:
        return self.citation is not None


class CitationAttacher:
    """Attaches source-identity citations to feedback items (Task 10.3).

    Pure logic — decides whether and which citation to attach based on
    retrieval results. Does NOT perform retrieval itself (that's the
    ReferenceStore's job via Task 10.1).

    The attacher:
    1. Matches each feedback item to the most relevant retrieval result.
    2. Attaches a citation if relevance exceeds the threshold.
    3. Never attaches a citation if no material informed the item.
    """

    def __init__(self, relevance_threshold: float = RELEVANCE_THRESHOLD) -> None:
        """Initialize with relevance threshold.

        ``relevance_threshold``: minimum similarity score (0.0–1.0) for a
        retrieval result to be considered "informing" an item. Below this,
        no citation is attached (Requirement 21.4).
        """
        if not (0.0 <= relevance_threshold <= 1.0):
            raise ValueError("relevance_threshold must be between 0.0 and 1.0")
        self._threshold = relevance_threshold

    @property
    def relevance_threshold(self) -> float:
        return self._threshold

    def attach_citations(
        self,
        items: list[ValidatedFeedbackItem] | tuple[ValidatedFeedbackItem, ...],
        retrieval_results: list[RetrievalResult],
    ) -> list[CitedFeedbackItem]:
        """Attach citations to feedback items based on retrieval results.

        For each item:
        - If the item already has a model-provided citation dict, try to
          validate it against retrieval results.
        - If no citation exists, find the best matching retrieval result
          based on content similarity to the item's question.
        - Attach a citation only if a result exceeds the relevance threshold.

        Requirement 21.1: "Attach a source-identity citation when specific
        material informed an item."
        Requirement 21.4: "No citation when none informed it."
        """
        cited: list[CitedFeedbackItem] = []

        for item in items:
            citation = self._resolve_citation(item, retrieval_results)
            cited.append(CitedFeedbackItem(item=item, citation=citation))

        return cited

    def attach_citations_structural(
        self,
        items: list[StructuralFeedbackItem] | tuple[StructuralFeedbackItem, ...],
        retrieval_results: list[RetrievalResult],
    ) -> list[CitedStructuralItem]:
        """Attach citations to structural feedback items."""
        cited: list[CitedStructuralItem] = []

        for item in items:
            citation = self._resolve_citation_for_structural(item, retrieval_results)
            cited.append(CitedStructuralItem(item=item, citation=citation))

        return cited

    def _resolve_citation(
        self,
        item: ValidatedFeedbackItem,
        retrieval_results: list[RetrievalResult],
    ) -> Optional[Citation]:
        """Resolve the citation for a single inline item.

        If the item already has a citation dict from the model (meaning
        the model indicated which reference it used), validate and use it.
        Otherwise, find the best retrieval match above threshold.
        """
        # If the model already attached a citation, validate it
        if item.citation and isinstance(item.citation, dict):
            title = item.citation.get("title", "")
            if title and title.strip():
                section = item.citation.get("section")
                return Citation(
                    title=title.strip(),
                    section=section.strip() if section else None,
                )

        # Otherwise, find the best matching retrieval result
        return self._best_match(retrieval_results)

    def _resolve_citation_for_structural(
        self,
        item: StructuralFeedbackItem,
        retrieval_results: list[RetrievalResult],
    ) -> Optional[Citation]:
        """Resolve citation for a structural item."""
        if item.citation and isinstance(item.citation, dict):
            title = item.citation.get("title", "")
            if title and title.strip():
                section = item.citation.get("section")
                return Citation(
                    title=title.strip(),
                    section=section.strip() if section else None,
                )

        return self._best_match(retrieval_results)

    def _best_match(
        self,
        retrieval_results: list[RetrievalResult],
    ) -> Optional[Citation]:
        """Find the highest-scoring retrieval result above threshold.

        Returns None if no result meets the threshold (Requirement 21.4:
        no citation when none informed it).
        """
        if not retrieval_results:
            return None

        # Results should be pre-sorted by score (descending), but sort anyway
        sorted_results = sorted(retrieval_results, key=lambda r: r.score, reverse=True)
        best = sorted_results[0]

        if best.score < self._threshold:
            return None

        return Citation(
            title=best.material_title,
            section=best.section or None,
        )
