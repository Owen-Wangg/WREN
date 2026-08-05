"""Property test: diff sensitivity depends only on the marker placeholder,
never on footnote body content (footnote-citation-support spec, Task 10.2).

For any pair of consecutive Drafts, if a paragraph's only difference is a
change to a footnote's `content`/citation attrs with the marker's position
and `[N]`/`[?]` placeholder text unchanged, the Diff_Engine classifies that
paragraph as UNCHANGED; if a paragraph's placeholder text itself changes (a
marker is added, removed, or its number changes), the Diff_Engine classifies
that paragraph as CHANGED, ADDED, or reflects the change accordingly.

By the time a footnote reaches the Diff_Engine, it has already been
flattened to a `[N]`/`[?]` placeholder string by `tipTapContentToSegments`
(Node side) — the Diff_Engine itself has no footnote-specific code, so this
property is really: for any pair of paragraph-text strings that may or may
not embed a `[N]`/`[?]`-shaped placeholder substring, DiffEngine.compute
classifies UNCHANGED iff the strings are equal, and the placeholder
substrings are ordinary literal text with no special handling.

Validates: Requirements 7.2, 7.4

Feature: footnote-citation-support, Property 14
"""
from hypothesis import given, settings
from hypothesis import strategies as st

import pytest

from wren_engine import ChangeKind, DiffEngine, Segment


def _placeholder_text() -> st.SearchStrategy[str]:
    return st.one_of(
        st.integers(min_value=1, max_value=200).map(lambda n: f"[{n}]"),
        st.just("[?]"),
    )


def _prose_text() -> st.SearchStrategy[str]:
    return st.text(
        alphabet=st.characters(blacklist_categories=("Cs",), blacklist_characters="[]"),
        min_size=0,
        max_size=30,
    )


@pytest.mark.property
class TestDiffSensitivityToPlaceholderOnly:
    """Property 14: Diff sensitivity depends only on the marker placeholder, never on footnote body content."""

    @settings(max_examples=150)
    @given(prefix=_prose_text(), placeholder=_placeholder_text(), suffix=_prose_text())
    def test_identical_placeholder_and_prose_is_unchanged(
        self, prefix: str, placeholder: str, suffix: str
    ) -> None:
        """A paragraph whose text (prose + placeholder) is byte-identical
        across Drafts is classified UNCHANGED — this models a footnote body
        edit that never touches the segment text (the segment only ever
        carried the placeholder, never the body)."""
        text = f"{prefix}{placeholder}{suffix}"
        engine = DiffEngine()
        prev = [Segment(index=0, text=text)]
        curr = [Segment(index=0, text=text)]

        diff = engine.compute(prev, curr)

        assert diff.is_empty is True
        assert all(c.kind is ChangeKind.UNCHANGED for c in diff.changes)

    @settings(max_examples=150)
    @given(
        prefix=_prose_text(),
        old_placeholder=_placeholder_text(),
        new_placeholder=_placeholder_text(),
        suffix=_prose_text(),
    )
    def test_different_placeholder_text_marks_changed(
        self, prefix: str, old_placeholder: str, new_placeholder: str, suffix: str
    ) -> None:
        """When the placeholder text itself differs (renumbering, or a
        [N] <-> [?] transition), the paragraph is marked CHANGED — unless
        the two placeholders happen to be equal, in which case it's the
        identical-text case above (still correctly UNCHANGED)."""
        if old_placeholder == new_placeholder:
            return  # not the case under test; covered by the identical-text property above

        prev_text = f"{prefix}{old_placeholder}{suffix}"
        curr_text = f"{prefix}{new_placeholder}{suffix}"
        if prev_text == curr_text:
            return  # prose could coincidentally make them equal in edge cases

        engine = DiffEngine()
        prev = [Segment(index=0, text=prev_text)]
        curr = [Segment(index=0, text=curr_text)]

        diff = engine.compute(prev, curr)

        assert diff.is_empty is False
        assert any(c.kind is ChangeKind.CHANGED for c in diff.changes)

    @settings(max_examples=100)
    @given(prose=_prose_text(), placeholder=_placeholder_text())
    def test_adding_a_placeholder_where_none_existed_marks_changed(
        self, prose: str, placeholder: str
    ) -> None:
        engine = DiffEngine()
        prev = [Segment(index=0, text=prose)]
        curr = [Segment(index=0, text=f"{prose}{placeholder}")]

        diff = engine.compute(prev, curr)

        if prose == f"{prose}{placeholder}":
            return  # placeholder was empty-equivalent (impossible given strategy, but defensive)

        assert diff.is_empty is False
        changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
        assert len(changed) == 1

    @settings(max_examples=100)
    @given(prose=_prose_text(), placeholder=_placeholder_text())
    def test_removing_a_placeholder_marks_changed(self, prose: str, placeholder: str) -> None:
        engine = DiffEngine()
        prev = [Segment(index=0, text=f"{prose}{placeholder}")]
        curr = [Segment(index=0, text=prose)]

        diff = engine.compute(prev, curr)

        assert diff.is_empty is False
        changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
        assert len(changed) == 1
