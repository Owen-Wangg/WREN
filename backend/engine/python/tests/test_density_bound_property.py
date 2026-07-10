"""Property test: Annotation density bound (Task 9.8 / Property 13).

For any document length and any configured Document-Type density setting,
the number of inline Feedback Items does not exceed the density bound and
is non-decreasing in document length for a fixed density.

Validates: Requirements 13.1, 13.2

Feature: wren-writing-coach, Property 13
"""
from __future__ import annotations

from hypothesis import given, settings, assume
from hypothesis import strategies as st

import pytest

from wren_engine.feedback_classifier import (
    DensitySetting,
    FeedbackClassifier,
    compute_density_cap,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem


# ─── Strategies ────────────────────────────────────────────────────────────────

_word_counts = st.integers(min_value=0, max_value=100_000)

_density_settings = st.sampled_from([
    DensitySetting.LOW,
    DensitySetting.MEDIUM,
    DensitySetting.HIGH,
])

_density_strings = st.sampled_from(["low", "medium", "high"])

_custom_multipliers = st.floats(min_value=0.5, max_value=20.0, allow_nan=False, allow_infinity=False)

_word_count_pairs = st.tuples(
    st.integers(min_value=0, max_value=100_000),
    st.integers(min_value=0, max_value=100_000),
)


def _make_inline_item(index: int) -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(
        category=f"Category{index % 5}",
        question=f"Question {index}?",
        anchor={"start": index * 10, "end": index * 10 + 8, "paragraph": index},
        citation=None,
    )


# ─── Property tests ───────────────────────────────────────────────────────────


@pytest.mark.property
class TestAnnotationDensityBoundProperty:
    """Property 13: Annotation density bound (REQ-FB-DENSITY-01)."""

    @settings(max_examples=200)
    @given(word_count=_word_counts, density=_density_settings)
    def test_cap_is_non_decreasing_in_document_length(
        self, word_count: int, density: DensitySetting
    ) -> None:
        """For a fixed density, the cap never decreases as word count grows.

        REQ-FB-DENSITY-01 criterion 1: "scale the number of inline Feedback
        Items in proportion to document length."
        """
        cap_at_wc = compute_density_cap(word_count, density)
        # Check that adding words never decreases the cap
        cap_at_wc_plus_100 = compute_density_cap(word_count + 100, density)
        assert cap_at_wc_plus_100 >= cap_at_wc, (
            f"Cap decreased: {cap_at_wc} at {word_count} words -> "
            f"{cap_at_wc_plus_100} at {word_count + 100} words"
        )

    @settings(max_examples=200)
    @given(pair=_word_count_pairs, density=_density_settings)
    def test_monotonicity_for_any_two_word_counts(
        self, pair: tuple[int, int], density: DensitySetting
    ) -> None:
        """For any two word counts, the longer one has >= the cap of the shorter.

        Stronger monotonicity property: not just adjacent values.
        """
        wc_a, wc_b = pair
        cap_a = compute_density_cap(wc_a, density)
        cap_b = compute_density_cap(wc_b, density)

        if wc_a <= wc_b:
            assert cap_a <= cap_b
        else:
            assert cap_a >= cap_b

    @settings(max_examples=200)
    @given(word_count=_word_counts, density=_density_settings)
    def test_cap_is_always_at_least_one(
        self, word_count: int, density: DensitySetting
    ) -> None:
        """The density cap is always >= 1 (minimum feedback guarantee).

        Even a very short document gets at least one feedback item.
        """
        cap = compute_density_cap(word_count, density)
        assert cap >= 1

    @settings(max_examples=200)
    @given(word_count=_word_counts, density=_density_settings)
    def test_cap_never_exceeds_maximum(
        self, word_count: int, density: DensitySetting
    ) -> None:
        """The density cap never exceeds the sanity maximum (50).

        Very long documents don't get unbounded feedback.
        """
        cap = compute_density_cap(word_count, density)
        assert cap <= 50

    @settings(max_examples=150)
    @given(
        word_count=_word_counts,
        density=_density_strings,
        n_items=st.integers(min_value=0, max_value=60),
    )
    def test_retained_items_never_exceed_cap(
        self, word_count: int, density: str, n_items: int
    ) -> None:
        """After density bounding, retained items never exceed the computed cap.

        REQ-FB-DENSITY-01 criterion 2: "THE Feedback_Engine SHALL apply
        that Document Type's density configuration."
        """
        classifier = FeedbackClassifier()
        items = [_make_inline_item(i) for i in range(n_items)]
        cap = compute_density_cap(word_count, density)

        result = classifier.apply_density_bound(items, word_count, density)

        assert len(result.retained) <= cap
        assert result.cap == cap

    @settings(max_examples=150)
    @given(
        word_count=_word_counts,
        density=_density_strings,
        n_items=st.integers(min_value=0, max_value=60),
    )
    def test_retained_plus_trimmed_equals_input(
        self, word_count: int, density: str, n_items: int
    ) -> None:
        """Retained + trimmed always equals the original input count.

        No items are lost or duplicated during density bounding.
        """
        classifier = FeedbackClassifier()
        items = [_make_inline_item(i) for i in range(n_items)]

        result = classifier.apply_density_bound(items, word_count, density)

        assert len(result.retained) + len(result.trimmed) == n_items

    @settings(max_examples=150)
    @given(
        word_count=st.integers(min_value=100, max_value=50_000),
        density=_density_strings,
    )
    def test_recurring_patterns_prioritized_when_cap_binds(
        self, word_count: int, density: str
    ) -> None:
        """When the cap binds, recurring categories are retained over one-offs.

        REQ-FB-DENSITY-01 criterion 3: "THE Feedback_Engine SHALL
        prioritize recurring patterns over isolated one-off issues."
        """
        classifier = FeedbackClassifier()
        cap = compute_density_cap(word_count, density)

        # Need more items than cap to trigger trimming
        assume(cap < 15)

        # Create items: "Recurring" appears 5 times, "OneOff_X" appears once each
        items = []
        for i in range(5):
            items.append(
                ValidatedFeedbackItem(
                    category="Recurring",
                    question=f"Recurring Q{i}?",
                    anchor={"start": i * 100, "end": i * 100 + 50, "paragraph": i},
                    citation=None,
                )
            )
        for i in range(10):
            items.append(
                ValidatedFeedbackItem(
                    category=f"OneOff_{i}",
                    question=f"One-off Q{i}?",
                    anchor={"start": 500 + i * 100, "end": 550 + i * 100, "paragraph": 5 + i},
                    citation=None,
                )
            )

        result = classifier.apply_density_bound(items, word_count, density)

        # Count recurring items in retained
        recurring_retained = sum(
            1 for item in result.retained if item.category == "Recurring"
        )
        oneoff_retained = sum(
            1 for item in result.retained if item.category.startswith("OneOff_")
        )

        # Recurring pattern should have more retained items (or all of them)
        # than any single one-off category
        if cap < 15:
            # With cap < 15 and 5 recurring + 10 one-offs, recurring should
            # dominate the retained set
            assert recurring_retained >= min(5, cap), (
                f"Expected >= {min(5, cap)} recurring items in retained, "
                f"got {recurring_retained} (cap={cap})"
            )

    @settings(max_examples=100)
    @given(
        word_count=_word_counts,
        custom_multiplier=_custom_multipliers,
    )
    def test_custom_multiplier_also_non_decreasing(
        self, word_count: int, custom_multiplier: float
    ) -> None:
        """Custom items-per-1000-words multipliers also produce non-decreasing caps."""
        cap_at_wc = compute_density_cap(
            word_count, "medium", custom_items_per_1000=custom_multiplier
        )
        cap_at_wc_plus = compute_density_cap(
            word_count + 500, "medium", custom_items_per_1000=custom_multiplier
        )
        assert cap_at_wc_plus >= cap_at_wc
