"""Focused invariant tests for the shared engine model vocabulary.

These dataclasses (``Segment``, ``Span``, ``ParagraphChange``, ``Diff``,
``ChangeKind``) are consumed by both the Diff Engine's LLM selection and the
forthcoming Anchor Service, so their invariants are locked here.
"""
import pytest

from wren_engine import ChangeKind, Diff, ParagraphChange, Span


def test_span_allows_zero_width_change_location():
    # A zero-width span marks a change *location* (e.g. a pure deletion point).
    span = Span(paragraph_index=2, start=5, end=5)
    assert span.start == span.end == 5


def test_span_rejects_reversed_range():
    with pytest.raises(ValueError, match="end must be >= start"):
        Span(paragraph_index=0, start=10, end=3)


def test_span_rejects_negative_offsets():
    with pytest.raises(ValueError, match="non-negative"):
        Span(paragraph_index=0, start=-1, end=4)


def test_empty_diff_is_empty_and_has_no_categorized_changes():
    diff = Diff()
    assert diff.is_empty is True
    assert diff.added == diff.deleted == diff.changed == diff.unchanged == ()


def test_diff_with_only_unchanged_is_empty():
    diff = Diff(
        changes=(
            ParagraphChange(kind=ChangeKind.UNCHANGED, prev_index=0, curr_index=0),
        )
    )
    assert diff.is_empty is True


def test_diff_categorizes_changes_by_kind():
    diff = Diff(
        changes=(
            ParagraphChange(kind=ChangeKind.UNCHANGED, prev_index=0, curr_index=0),
            ParagraphChange(kind=ChangeKind.CHANGED, prev_index=1, curr_index=1),
            ParagraphChange(kind=ChangeKind.ADDED, curr_index=2),
            ParagraphChange(kind=ChangeKind.DELETED, prev_index=2),
        )
    )
    assert diff.is_empty is False
    assert len(diff.unchanged) == 1
    assert len(diff.changed) == 1
    assert len(diff.added) == 1
    assert len(diff.deleted) == 1
