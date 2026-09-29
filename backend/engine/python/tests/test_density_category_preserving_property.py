"""Property tests: category-preserving density trim (bugfix Task 3.7).

When the inline density cap binds, the trim reserves one slot per preserved
(enabled) category before filling by recurrence. With
``preserve_categories=None`` the trim is exactly the original recurrence trim.

**Validates: Requirements 1.7, 2.7, 3.6, 3.7**
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.feedback_classifier import (
    FeedbackClassifier,
    apply_raw_inline_density_cap,
    compute_density_cap,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem

_SETTINGS = settings(max_examples=200, deadline=None)

_ALPHABET = ("A", "B", "C", "D", "E", "F", "G", "H")

# Skew category draws so one category often dominates (the crowd-out shape).
_categories = st.one_of(
    st.sampled_from(_ALPHABET),
    st.just("A"),
    st.just("A"),
)
_category_lists = st.lists(_categories, min_size=0, max_size=40)
_caps = st.integers(min_value=1, max_value=24)
_preserve_sets = st.lists(
    st.sampled_from(_ALPHABET + ("X", "Y")), unique=True, max_size=10
)


def _word_count_for_cap(cap: int) -> int:
    """Medium density is 4 items / 1000 words, so ``cap * 250`` words → ``cap``."""
    word_count = cap * 250
    assert compute_density_cap(word_count, "medium") == cap
    return word_count


def _wrappers(categories: list[str]) -> list[ValidatedFeedbackItem]:
    return [
        ValidatedFeedbackItem(category=c, question=f"Q{k}?")
        for k, c in enumerate(categories)
    ]


def _frozen_original_retained(
    items: list[ValidatedFeedbackItem], cap: int
) -> list[ValidatedFeedbackItem]:
    """Frozen copy of the original recurrence trim (``_prioritize_by_recurrence``)."""
    if len(items) <= cap:
        return list(items)
    counts = Counter(item.category for item in items)
    scored = sorted(
        ((counts[item.category], idx, item) for idx, item in enumerate(items)),
        key=lambda x: (-x[0], x[1]),
    )
    return [item for _, _, item in scored][:cap]


def _category_rank(categories: list[str], preserve: set[str]) -> list[str]:
    """Preserved categories present, ranked by (-count, first index)."""
    counts = Counter(categories)
    first = {c: categories.index(c) for c in counts}
    present = [c for c in counts if c in preserve]
    return sorted(present, key=lambda c: (-counts[c], first[c]))


@_SETTINGS
@given(categories=_category_lists, cap=_caps, preserve=_preserve_sets)
def test_retained_count_and_partition(
    categories: list[str], cap: int, preserve: list[str]
) -> None:
    items = _wrappers(categories)
    outcome = FeedbackClassifier().apply_density_bound(
        items, _word_count_for_cap(cap), "medium", preserve_categories=preserve
    )
    assert outcome.cap == cap
    assert len(outcome.retained) == min(len(items), cap)
    retained_ids = [id(i) for i in outcome.retained]
    trimmed_ids = [id(i) for i in outcome.trimmed]
    assert len(set(retained_ids)) == len(retained_ids)
    assert sorted(retained_ids + trimmed_ids) == sorted(id(i) for i in items)


@_SETTINGS
@given(categories=_category_lists, cap=_caps, preserve=_preserve_sets)
def test_preserved_categories_kept_when_cap_allows(
    categories: list[str], cap: int, preserve: list[str]
) -> None:
    items = _wrappers(categories)
    ranked = _category_rank(categories, set(preserve))
    outcome = FeedbackClassifier().apply_density_bound(
        items, _word_count_for_cap(cap), "medium", preserve_categories=preserve
    )
    kept = {i.category for i in outcome.retained}
    if cap >= len(ranked):
        # cap >= K: every preserved category that had an inline item survives.
        assert set(ranked) <= kept
    else:
        # cap < K: exactly the top ``cap`` preserved categories, one item each.
        assert kept == set(ranked[:cap])
        assert len(outcome.retained) == cap


@_SETTINGS
@given(categories=_category_lists, cap=_caps)
def test_none_equals_frozen_original(categories: list[str], cap: int) -> None:
    items = _wrappers(categories)
    outcome = FeedbackClassifier().apply_density_bound(
        items, _word_count_for_cap(cap), "medium", preserve_categories=None
    )
    expected = _frozen_original_retained(items, cap)
    assert [id(i) for i in outcome.retained] == [id(i) for i in expected]


_raw_items = st.lists(
    st.tuples(st.sampled_from(["inline", "inline", "strength", "structural"]), _categories),
    max_size=40,
).map(
    lambda pairs: [
        {"kind": kind, "error_category_id": cat, "question_text": f"Q{k}?"}
        for k, (kind, cat) in enumerate(pairs)
    ]
)


@_SETTINGS
@given(items=_raw_items, cap=_caps, preserve=_preserve_sets)
def test_raw_cap_leaves_non_inline_untouched_and_ordered(
    items: list[dict[str, Any]], cap: int, preserve: list[str]
) -> None:
    result = apply_raw_inline_density_cap(
        items,
        word_count=_word_count_for_cap(cap),
        density="medium",
        preserve_categories=preserve,
    )
    non_inline_in = [id(i) for i in items if i["kind"] != "inline"]
    non_inline_out = [id(i) for i in result if i["kind"] != "inline"]
    assert non_inline_out == non_inline_in

    inline_in = [i for i in items if i["kind"] == "inline"]
    inline_out = [i for i in result if i["kind"] == "inline"]
    assert len(inline_out) == min(len(inline_in), cap)
    # Output is a subsequence of the input (original order preserved).
    positions = [next(k for k, i in enumerate(items) if i is item) for item in result]
    assert positions == sorted(positions)


@_SETTINGS
@given(items=_raw_items, cap=_caps)
def test_raw_cap_none_matches_no_keyword(items: list[dict[str, Any]], cap: int) -> None:
    word_count = _word_count_for_cap(cap)
    with_none = apply_raw_inline_density_cap(
        items, word_count=word_count, density="medium", preserve_categories=None
    )
    no_keyword = apply_raw_inline_density_cap(items, word_count=word_count, density="medium")
    assert [id(i) for i in with_none] == [id(i) for i in no_keyword]
