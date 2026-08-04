"""Property test: diff sensitivity depends only on the marker placeholder,
never on footnote body content (footnote-citation-support spec, Task 10.2).

Feature: footnote-citation-support, Property 14: Diff sensitivity depends
only on the marker placeholder, never on footnote body content.

Validates: Requirements 7.2, 7.4

By the time text reaches the DiffEngine, `tipTapContentToSegments` (Node side)
has already flattened footnotes into `[N]`/`[?]` placeholders within segment
text. The DiffEngine itself has no footnote-specific logic — it operates on
plain strings. These tests confirm that:
  - Two segments identical except for "invisible" footnote body changes
    (same placeholder text) are UNCHANGED (Requirement 7.4).
  - Two segments differing in placeholder text (marker added, removed, or
    renumbered) are CHANGED (Requirement 7.2).
"""
from hypothesis import given, settings, assume
from hypothesis import strategies as st

import pytest

from wren_engine import ChangeKind, DiffEngine, Segment


def segs(*texts: str) -> list[Segment]:
    return [Segment(index=i, text=t) for i, t in enumerate(texts)]


# Safe text that doesn't accidentally look like a placeholder
_safe_prose = st.text(
    alphabet=st.characters(categories=("L", "Zs"), exclude_characters="[]"),
    min_size=1,
    max_size=50,
).map(lambda s: s.strip()).filter(lambda s: len(s) > 0)

_footnote_number = st.integers(min_value=1, max_value=200)


class TestProperty14DiffPlaceholderSensitivity:
    """Property 14: Diff sensitivity depends only on the marker placeholder,
    never on footnote body content."""

    @given(_safe_prose, _footnote_number)
    @settings(max_examples=100)
    def test_same_placeholder_text_is_unchanged(self, prose: str, num: int):
        """When only the footnote body changes (but the segment text with
        placeholder stays identical), the diff reports UNCHANGED."""
        # Simulate: same paragraph with same [N] placeholder in both drafts.
        # The "body changed" is invisible to the diff engine because segment
        # text is the same.
        text = f"{prose}.[{num}]"
        engine = DiffEngine()
        prev = segs(text)
        curr = segs(text)
        diff = engine.compute(prev, curr)
        assert diff.is_empty is True

    @given(_safe_prose, _footnote_number)
    @settings(max_examples=100)
    def test_adding_placeholder_marks_changed(self, prose: str, num: int):
        """Adding a placeholder marker to a paragraph marks it as changed."""
        engine = DiffEngine()
        prev = segs(prose)
        curr = segs(f"{prose}[{num}]")
        diff = engine.compute(prev, curr)
        assert diff.is_empty is False
        changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
        assert len(changed) >= 1

    @given(_safe_prose, _footnote_number)
    @settings(max_examples=100)
    def test_removing_placeholder_marks_changed(self, prose: str, num: int):
        """Removing a placeholder marker from a paragraph marks it as changed."""
        engine = DiffEngine()
        prev = segs(f"{prose}[{num}]")
        curr = segs(prose)
        diff = engine.compute(prev, curr)
        assert diff.is_empty is False
        changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
        assert len(changed) >= 1

    @given(_safe_prose, _footnote_number, _footnote_number)
    @settings(max_examples=100)
    def test_renumbering_placeholder_marks_changed(self, prose: str, old_num: int, new_num: int):
        """Renumbering a placeholder (different digits) marks the paragraph changed."""
        assume(old_num != new_num)
        engine = DiffEngine()
        prev = segs(f"{prose}[{old_num}]")
        curr = segs(f"{prose}[{new_num}]")
        diff = engine.compute(prev, curr)
        assert diff.is_empty is False
        changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
        assert len(changed) >= 1

    @given(
        _safe_prose,
        st.lists(_footnote_number, min_size=1, max_size=5),
    )
    @settings(max_examples=100)
    def test_multiple_placeholders_unchanged_when_text_identical(
        self, prose: str, numbers: list[int]
    ):
        """Multiple placeholders in one paragraph: identical text = UNCHANGED."""
        placeholders = "".join(f"[{n}]" for n in numbers)
        text = f"{prose}{placeholders}"
        engine = DiffEngine()
        prev = segs(text)
        curr = segs(text)
        diff = engine.compute(prev, curr)
        assert diff.is_empty is True

    @given(_safe_prose)
    @settings(max_examples=50)
    def test_malformed_placeholder_question_mark_treated_as_literal(self, prose: str):
        """The [?] placeholder (malformed footnote) is literal text — adding it
        marks the paragraph changed."""
        engine = DiffEngine()
        prev = segs(prose)
        curr = segs(f"{prose}[?]")
        diff = engine.compute(prev, curr)
        assert diff.is_empty is False
