"""Property test: the FOOTNOTES/CITATIONS block is present iff footnotes
exist, and stays untrusted data (footnote-citation-support spec, Task 9.2).

Feature: footnote-citation-support, Property 11: The FOOTNOTES/CITATIONS
block is present iff footnotes exist, and stays untrusted data.

Validates: Requirements 5.2, 5.3, 5.6

For any list of FootnoteMetadata:
  - Empty list → returns None (block absent; prompt unchanged from
    no-footnotes case — Requirement 5.6).
  - Non-empty list → returns an UntrustedContent with label
    "FOOTNOTES/CITATIONS" (Requirement 5.2), whose text contains every
    footnote's number and content (Requirement 5.3).
  - The returned block is an UntrustedContent instance (never injected into
    system scaffolding — stays untrusted data).
"""
from hypothesis import given, settings, assume
from hypothesis import strategies as st

import pytest

from wren_engine.footnote_metadata import (
    FootnoteMetadata,
    build_footnotes_untrusted_content,
)
from wren_engine.prompt_assembly import UntrustedContent


# ─── Strategies ────────────────────────────────────────────────────────────────

_safe_text = st.text(
    alphabet=st.characters(
        categories=("L", "N", "P", "Z"),
        exclude_characters="\x00",
    ),
    min_size=1,
    max_size=100,
)

_footnote_metadata_strategy = st.builds(
    FootnoteMetadata,
    footnote_number=st.integers(min_value=1, max_value=200),
    content=_safe_text,
    author=st.one_of(st.just(""), _safe_text),
    title=st.one_of(st.just(""), _safe_text),
    source=st.one_of(st.just(""), _safe_text),
    pinpoint=st.one_of(st.just(""), _safe_text),
    year=st.one_of(st.just(""), _safe_text),
)


# ─── Property 11 ──────────────────────────────────────────────────────────────


class TestProperty11FootnotesCitationsBlock:
    """Property 11: The FOOTNOTES/CITATIONS block is present iff footnotes exist,
    and stays untrusted data."""

    @given(st.just([]))
    @settings(max_examples=10)
    def test_empty_list_returns_none(self, footnotes: list):
        """Empty footnotes → None (prompt unchanged, Requirement 5.6)."""
        result = build_footnotes_untrusted_content(footnotes)
        assert result is None

    @given(st.lists(_footnote_metadata_strategy, min_size=1, max_size=15))
    @settings(max_examples=100)
    def test_non_empty_list_returns_untrusted_content_with_correct_label(
        self, footnotes: list[FootnoteMetadata]
    ):
        """Non-empty → UntrustedContent with label FOOTNOTES/CITATIONS (Req 5.2)."""
        result = build_footnotes_untrusted_content(footnotes)
        assert result is not None
        assert isinstance(result, UntrustedContent)
        assert result.label == "FOOTNOTES/CITATIONS"

    @given(st.lists(_footnote_metadata_strategy, min_size=1, max_size=15))
    @settings(max_examples=100)
    def test_block_text_contains_every_footnote_number_and_content(
        self, footnotes: list[FootnoteMetadata]
    ):
        """Every footnote's number and content appear in the block (Req 5.3)."""
        result = build_footnotes_untrusted_content(footnotes)
        assert result is not None
        for fn in footnotes:
            assert f"[{fn.footnote_number}]" in result.text
            assert fn.content in result.text

    @given(st.lists(_footnote_metadata_strategy, min_size=1, max_size=10))
    @settings(max_examples=100)
    def test_block_text_contains_non_empty_citation_fields(
        self, footnotes: list[FootnoteMetadata]
    ):
        """Non-empty citation fields appear in the block text (Req 5.3)."""
        result = build_footnotes_untrusted_content(footnotes)
        assert result is not None
        for fn in footnotes:
            if fn.author:
                assert fn.author in result.text
            if fn.title:
                assert fn.title in result.text
            if fn.source:
                assert fn.source in result.text
            if fn.pinpoint:
                assert fn.pinpoint in result.text
            if fn.year:
                assert fn.year in result.text

    @given(
        st.lists(_footnote_metadata_strategy, min_size=1, max_size=5),
        st.text(
            alphabet=st.characters(categories=("L", "N", "P")),
            min_size=10,
            max_size=200,
        ),
    )
    @settings(max_examples=50)
    def test_adversarial_footnote_content_stays_in_untrusted_block(
        self, footnotes: list[FootnoteMetadata], adversarial_payload: str
    ):
        """Adversarial content in footnotes stays as UntrustedContent data,
        never leaks into system scaffolding."""
        # Inject the adversarial payload into the first footnote's content.
        modified = [
            FootnoteMetadata(
                footnote_number=footnotes[0].footnote_number,
                content=adversarial_payload,
                author=footnotes[0].author,
                title=footnotes[0].title,
                source=footnotes[0].source,
                pinpoint=footnotes[0].pinpoint,
                year=footnotes[0].year,
            ),
            *footnotes[1:],
        ]
        result = build_footnotes_untrusted_content(modified)
        assert result is not None
        assert isinstance(result, UntrustedContent)
        # The adversarial payload is IN the text field (data), not in the label
        # (which stays fixed at "FOOTNOTES/CITATIONS").
        assert result.label == "FOOTNOTES/CITATIONS"
        assert adversarial_payload in result.text
