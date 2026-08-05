"""Property test: anchor fingerprints are stable across text containing
footnote placeholders (footnote-citation-support spec, Task 10.4).

For any paragraph text containing one or more `[N]`/`[?]` placeholders,
`compute_fingerprint` and `AnchorService.remap` operate on that text
identically to any other literal text — an anchor whose span includes a
placeholder re-maps correctly when the surrounding text is unchanged, and is
marked `removed` under the same rewritten-beyond-recognition/ambiguous
conditions as any other span.

Validates: Requirements 7.3

Feature: footnote-citation-support, Property 15
"""
from hypothesis import given, settings
from hypothesis import strategies as st

import pytest

from wren_engine import (
    Anchor,
    AnchorService,
    AnchorState,
    DiffEngine,
    Remapped,
    Removed,
    Segment,
    compute_fingerprint,
)


def _placeholder_text() -> st.SearchStrategy[str]:
    return st.one_of(
        st.integers(min_value=1, max_value=200).map(lambda n: f"[{n}]"),
        st.just("[?]"),
    )


def _prose_text(min_size: int = 1, max_size: int = 20) -> st.SearchStrategy[str]:
    return st.text(
        alphabet=st.characters(blacklist_categories=("Cs",), blacklist_characters="[]"),
        min_size=min_size,
        max_size=max_size,
    ).filter(lambda s: s.strip())


@pytest.mark.property
class TestAnchorFingerprintStabilityWithPlaceholders:
    """Property 15: Anchor fingerprints are stable across text containing footnote placeholders."""

    @settings(max_examples=150)
    @given(prefix=_prose_text(), placeholder=_placeholder_text(), suffix=_prose_text())
    def test_fingerprint_is_deterministic_for_a_span_including_a_placeholder(
        self, prefix: str, placeholder: str, suffix: str
    ) -> None:
        text = f"{prefix}{placeholder}{suffix}"
        start = len(prefix)
        end = start + len(placeholder)

        fp1 = compute_fingerprint(text, start, end)
        fp2 = compute_fingerprint(text, start, end)

        assert fp1 == fp2
        assert fp1.matches(fp2)

    @settings(max_examples=150)
    @given(
        prefix=_prose_text(),
        placeholder=_placeholder_text(),
        suffix=_prose_text(),
        other_prose_prefix=_prose_text(),
    )
    def test_anchor_spanning_a_placeholder_remaps_when_paragraph_shifts_position(
        self, prefix: str, placeholder: str, suffix: str, other_prose_prefix: str
    ) -> None:
        """An anchor whose span includes a placeholder re-maps correctly when
        the paragraph shifts position (an unrelated paragraph inserted
        above) but its own text is unchanged — the placeholder-bearing span
        is treated identically to any other literal-text span."""
        text = f"{prefix}{placeholder}{suffix}"
        engine = DiffEngine()
        prev = [Segment(index=0, text=text)]
        curr = [
            Segment(index=0, text=other_prose_prefix or "Intro."),
            Segment(index=1, text=text),
        ]

        start = len(prefix)
        end = start + len(placeholder)
        anchor = Anchor.create(text, paragraph_index=0, start_offset=start, end_offset=end)

        diff = engine.compute(prev, curr)
        [result] = AnchorService().remap([anchor], diff)

        assert isinstance(result, Remapped)
        assert result.anchor.paragraph_index == 1
        assert (result.anchor.start_offset, result.anchor.end_offset) == (start, end)
        assert result.anchor.state is AnchorState.ACTIVE
        assert curr[1].text[result.anchor.start_offset : result.anchor.end_offset] == placeholder

    @settings(max_examples=100)
    @given(placeholder=_placeholder_text(), replacement_prose=_prose_text(min_size=5))
    def test_anchor_over_a_placeholder_removed_when_span_rewritten_beyond_recognition(
        self, placeholder: str, replacement_prose: str
    ) -> None:
        """When the placeholder-containing span is rewritten beyond
        recognition (the whole paragraph replaced with unrelated text), the
        anchor is marked removed — same as any other span, no special
        footnote-aware leniency."""
        prev_text = f"Some prior claim {placeholder} here."
        curr_text = f"An entirely unrelated sentence about {replacement_prose}."
        if prev_text == curr_text:
            return

        engine = DiffEngine()
        prev = [Segment(index=0, text=prev_text)]
        curr = [Segment(index=0, text=curr_text)]

        start = prev_text.index(placeholder)
        end = start + len(placeholder)
        anchor = Anchor.create(prev_text, paragraph_index=0, start_offset=start, end_offset=end)

        diff = engine.compute(prev, curr)
        [result] = AnchorService().remap([anchor], diff)

        assert isinstance(result, Removed)
        assert result.anchor.state is AnchorState.REMOVED

    @settings(max_examples=100)
    @given(a_placeholder=_placeholder_text(), b_placeholder=_placeholder_text())
    def test_fingerprint_distinguishes_spans_with_different_placeholder_numbers(
        self, a_placeholder: str, b_placeholder: str
    ) -> None:
        """Two spans differing only in their placeholder's digits produce
        different fingerprints when the placeholders differ — the digits are
        literal text like any other, not normalized away."""
        if a_placeholder == b_placeholder:
            return
        fp_a = compute_fingerprint(f"Claim.{a_placeholder}", 6, 6 + len(a_placeholder))
        fp_b = compute_fingerprint(f"Claim.{b_placeholder}", 6, 6 + len(b_placeholder))
        assert fp_a.text_hash != fp_b.text_hash
