"""Property test: Feedback citation presence and content (Task 10.4 / Property 20).

For any Feedback Item and any set of retrieval results:

1. A citation is attached if and only if some retrieval result meets or
   exceeds the relevance threshold (or the item already carries a
   model-provided citation with a non-empty title).
2. When attached, a citation contains ONLY source-identity fields
   (title, optional section) — never the retrieved content itself and
   never anything resembling replacement prose.
3. When no result meets the threshold and the item carries no
   model-provided citation, no citation is attached at all.

Validates: Requirements 21.1, 21.3, 21.4

Feature: wren-writing-coach, Property 20
"""
from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.citation_attachment import (
    Citation,
    CitationAttacher,
    RELEVANCE_THRESHOLD,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem
from wren_engine.reference_store import (
    ReferenceChunk,
    ReferenceTier,
    RetrievalResult,
)
from wren_engine.structural_feedback import StructuralFeedbackItem


# ─── Strategies ────────────────────────────────────────────────────────────────

_scores = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_titles = st.text(min_size=1, max_size=15).filter(lambda s: s.strip() != "")
_sections = st.one_of(st.none(), st.text(min_size=1, max_size=10).filter(lambda s: s.strip() != ""))


def _make_chunk(idx: int) -> ReferenceChunk:
    return ReferenceChunk(
        reference_material_id=f"mat-{idx}",
        chunk_index=0,
        content=f"Some source content #{idx}",
        tier=ReferenceTier.DEPARTMENT,
        department_id="dept-1",
        document_type_id=None,
    )


def _retrieval_result(score: float, title: str, section: str | None, idx: int = 0) -> RetrievalResult:
    return RetrievalResult(
        chunk=_make_chunk(idx),
        score=score,
        material_title=title,
        section=section or "",
    )


def _plain_item(question: str = "Have you considered X?") -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(category="Grammar", question=question, anchor=None, citation=None)


@pytest.mark.property
class TestCitationPresenceAndContentProperty:
    """Property 20: Feedback citation presence and content (REQ-REFMAT-CITE-01)."""

    # Feature: wren-writing-coach, Property 20: Feedback citation presence and content

    @settings(max_examples=200)
    @given(score=_scores, title=_titles, section=_sections)
    def test_citation_attached_iff_score_meets_threshold(
        self, score: float, title: str, section: str | None
    ) -> None:
        """A citation is attached exactly when the best retrieval score
        meets/exceeds the configured relevance threshold."""
        attacher = CitationAttacher()
        item = _plain_item()
        result = _retrieval_result(score, title, section)

        cited = attacher.attach_citations([item], [result])
        assert len(cited) == 1

        if score >= RELEVANCE_THRESHOLD:
            assert cited[0].has_citation
            assert cited[0].citation.title == title
        else:
            assert not cited[0].has_citation

    @settings(max_examples=200)
    @given(
        scores_titles=st.lists(
            st.tuples(_scores, _titles, _sections), min_size=0, max_size=8
        )
    )
    def test_no_citation_when_no_result_meets_threshold(
        self, scores_titles: list[tuple[float, str, str | None]]
    ) -> None:
        """If every retrieval result is below threshold (or there are no
        results at all), no citation is attached — never fabricated."""
        # Force everything below threshold regardless of what Hypothesis drew.
        below = [
            (min(score, RELEVANCE_THRESHOLD * 0.99), title, section)
            for score, title, section in scores_titles
        ]
        results = [
            _retrieval_result(score, title, section, idx)
            for idx, (score, title, section) in enumerate(below)
        ]
        attacher = CitationAttacher()
        item = _plain_item()

        cited = attacher.attach_citations([item], results)

        assert len(cited) == 1
        assert not cited[0].has_citation
        assert cited[0].citation is None

    @settings(max_examples=200)
    @given(
        scores=st.lists(_scores, min_size=1, max_size=10),
        titles=st.lists(_titles, min_size=1, max_size=10),
    )
    def test_attached_citation_matches_highest_scoring_result(
        self, scores: list[float], titles: list[str]
    ) -> None:
        """When a citation is attached, it corresponds to the single
        highest-scoring retrieval result among those at/above threshold."""
        n = min(len(scores), len(titles))
        scores, titles = scores[:n], titles[:n]
        results = [
            _retrieval_result(score, title, None, idx)
            for idx, (score, title) in enumerate(zip(scores, titles))
        ]
        attacher = CitationAttacher()
        item = _plain_item()

        cited = attacher.attach_citations([item], results)[0]

        best = max(results, key=lambda r: r.score) if results else None
        if best is not None and best.score >= RELEVANCE_THRESHOLD:
            assert cited.has_citation
            assert cited.citation.title == best.material_title
        else:
            assert not cited.has_citation

    @settings(max_examples=200)
    @given(score=_scores, title=_titles, section=_sections)
    def test_citation_contains_only_source_identity_fields(
        self, score: float, title: str, section: str | None
    ) -> None:
        """A produced citation carries ONLY title/section — never the raw
        retrieved content, and never anything from the item's own question
        text (no replacement prose leaks into the citation)."""
        attacher = CitationAttacher(relevance_threshold=0.0)  # force attachment
        item = _plain_item()
        chunk_content = "This exact retrieved content must never appear in citation"
        result = RetrievalResult(
            chunk=ReferenceChunk(
                reference_material_id="mat-x",
                chunk_index=0,
                content=chunk_content,
                tier=ReferenceTier.DEPARTMENT,
                department_id="dept-1",
                document_type_id=None,
            ),
            score=max(score, 0.0),
            material_title=title,
            section=section or "",
        )

        cited = attacher.attach_citations([item], [result])[0]

        assert cited.has_citation
        as_dict = cited.citation.to_dict()
        assert set(as_dict.keys()) <= {"title", "section"}
        assert chunk_content not in as_dict.get("title", "")
        assert chunk_content not in as_dict.get("section", "")

    @settings(max_examples=100)
    @given(score=_scores, title=_titles, section=_sections)
    def test_structural_items_follow_same_presence_rule(
        self, score: float, title: str, section: str | None
    ) -> None:
        """The same presence/absence rule applies uniformly to document-wide
        structural feedback items, not just inline items."""
        attacher = CitationAttacher()
        item = StructuralFeedbackItem(category="Organization", question="How is this organized?")
        result = _retrieval_result(score, title, section)

        cited = attacher.attach_citations_structural([item], [result])
        assert len(cited) == 1

        if score >= RELEVANCE_THRESHOLD:
            assert cited[0].has_citation
        else:
            assert not cited[0].has_citation

    @settings(max_examples=100)
    @given(title=_titles, section=_sections)
    def test_preexisting_model_citation_with_nonempty_title_is_preserved(
        self, title: str, section: str | None
    ) -> None:
        """If the model already supplied a citation dict with a non-empty
        title, it is honored (validated) even without a fresh retrieval
        match — the engine doesn't silently drop a model-attributed source."""
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Grammar",
            question="Have you considered X?",
            anchor=None,
            citation={"title": title, **({"section": section} if section else {})},
        )

        cited = attacher.attach_citations([item], [])[0]

        assert cited.has_citation
        assert cited.citation.title == title.strip()

    def test_relevance_threshold_bounds_are_enforced(self) -> None:
        """Constructing an attacher outside [0.0, 1.0] must raise — a basic
        sanity/robustness check on the threshold contract itself."""
        with pytest.raises(ValueError):
            CitationAttacher(relevance_threshold=-0.1)
        with pytest.raises(ValueError):
            CitationAttacher(relevance_threshold=1.1)
