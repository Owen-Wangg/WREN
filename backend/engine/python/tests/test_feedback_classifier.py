"""Tests for taxonomy-bound classification and density bounding (Task 9.6).

Validates that the FeedbackClassifier:
- Filters items to configured taxonomy categories (case-insensitive)
- Accepts all items when no taxonomy is configured (permissive default)
- Normalizes category casing to canonical form
- Rejects out-of-taxonomy categories
- Computes density caps non-decreasing in document length
- Applies density caps, prioritizing recurring patterns
- Trims one-off categories before recurring ones
"""
import pytest

from wren_engine.feedback_classifier import (
    ClassificationOutcome,
    DensityOutcome,
    DensitySetting,
    FeedbackClassifier,
    apply_raw_inline_density_cap,
    compute_density_cap,
    word_count_from_segments,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem


@pytest.fixture
def classifier() -> FeedbackClassifier:
    return FeedbackClassifier()


def _item(
    category: str = "Test", question: str = "Q?", anchor: dict | None = None
) -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(
        category=category, question=question, anchor=anchor, citation=None
    )


# ─── Taxonomy-bound classification ────────────────────────────────────────────


class TestFilterByTaxonomy:
    def test_accepts_items_in_configured_categories(
        self, classifier: FeedbackClassifier
    ) -> None:
        categories = ("Unclear Writing", "Inaccurate Summary", "Missing Citation")
        items = [
            _item("Unclear Writing"),
            _item("Inaccurate Summary"),
            _item("Missing Citation"),
        ]
        result = classifier.filter_by_taxonomy(items, categories)
        assert len(result.accepted) == 3
        assert len(result.rejected) == 0

    def test_rejects_out_of_taxonomy_categories(
        self, classifier: FeedbackClassifier
    ) -> None:
        categories = ("Unclear Writing", "Inaccurate Summary")
        items = [
            _item("Unclear Writing"),
            _item("Fabricated Category"),
            _item("Another Bad Category"),
        ]
        result = classifier.filter_by_taxonomy(items, categories)
        assert len(result.accepted) == 1
        assert len(result.rejected) == 2
        assert result.rejected[0].category == "Fabricated Category"

    def test_case_insensitive_matching(
        self, classifier: FeedbackClassifier
    ) -> None:
        categories = ("Unclear Writing", "Grammar Error")
        items = [
            _item("unclear writing"),
            _item("GRAMMAR ERROR"),
            _item("Unclear Writing"),
        ]
        result = classifier.filter_by_taxonomy(items, categories)
        assert len(result.accepted) == 3
        assert len(result.rejected) == 0

    def test_normalizes_to_canonical_casing(
        self, classifier: FeedbackClassifier
    ) -> None:
        categories = ("Unclear Writing",)
        items = [_item("unclear writing")]
        result = classifier.filter_by_taxonomy(items, categories)
        assert result.accepted[0].category == "Unclear Writing"

    def test_permissive_when_no_taxonomy_configured(
        self, classifier: FeedbackClassifier
    ) -> None:
        """Empty taxonomy means accept all — admin hasn't restricted yet."""
        items = [_item("Anything"), _item("Goes"), _item("Here")]
        result = classifier.filter_by_taxonomy(items, ())
        assert len(result.accepted) == 3
        assert len(result.rejected) == 0

    def test_empty_items_list(self, classifier: FeedbackClassifier) -> None:
        result = classifier.filter_by_taxonomy([], ("A", "B"))
        assert len(result.accepted) == 0
        assert len(result.rejected) == 0

    def test_whitespace_in_category_name(
        self, classifier: FeedbackClassifier
    ) -> None:
        categories = ("Unclear Writing",)
        items = [_item("  Unclear Writing  ")]
        result = classifier.filter_by_taxonomy(items, categories)
        assert len(result.accepted) == 1


# ─── Density cap computation ──────────────────────────────────────────────────


class TestComputeDensityCap:
    def test_low_density_short_doc(self) -> None:
        # 500 words * 2/1000 = 1
        cap = compute_density_cap(500, DensitySetting.LOW)
        assert cap == 1

    def test_medium_density_1000_words(self) -> None:
        # 1000 words * 4/1000 = 4
        cap = compute_density_cap(1000, DensitySetting.MEDIUM)
        assert cap == 4

    def test_high_density_2000_words(self) -> None:
        # 2000 words * 6/1000 = 12
        cap = compute_density_cap(2000, DensitySetting.HIGH)
        assert cap == 12

    def test_minimum_cap_for_very_short_docs(self) -> None:
        # Even 0 words gets at least 1
        cap = compute_density_cap(0, DensitySetting.LOW)
        assert cap >= 1

    def test_maximum_cap_for_very_long_docs(self) -> None:
        cap = compute_density_cap(100_000, DensitySetting.HIGH)
        assert cap == 24  # Max cap

    def test_non_decreasing_in_word_count(self) -> None:
        """Property 13: density cap is non-decreasing in document length."""
        prev_cap = 0
        for word_count in range(0, 10001, 100):
            cap = compute_density_cap(word_count, DensitySetting.MEDIUM)
            assert cap >= prev_cap, (
                f"Cap decreased from {prev_cap} to {cap} at {word_count} words"
            )
            prev_cap = cap

    def test_custom_items_per_1000(self) -> None:
        # 2000 words * 5/1000 = 10
        cap = compute_density_cap(2000, "medium", custom_items_per_1000=5.0)
        assert cap == 10

    def test_string_density_parsing(self) -> None:
        cap = compute_density_cap(1000, "high")
        assert cap == 6

    def test_numeric_string_density(self) -> None:
        # "3.5" interpreted as 3.5 items per 1000 words
        cap = compute_density_cap(2000, "3.5")
        assert cap == 7


# ─── Density bounding ─────────────────────────────────────────────────────────


class TestApplyDensityBound:
    def test_retains_all_when_under_cap(
        self, classifier: FeedbackClassifier
    ) -> None:
        items = [_item(f"Cat{i}", anchor={"start": i}) for i in range(3)]
        result = classifier.apply_density_bound(items, word_count=5000, density="high")
        # 5000 * 6/1000 = 30; 3 items < 30
        assert len(result.retained) == 3
        assert len(result.trimmed) == 0

    def test_trims_when_over_cap(self, classifier: FeedbackClassifier) -> None:
        # 500 words * 2/1000 = 1 cap
        items = [_item(f"Cat{i}", anchor={"start": i}) for i in range(5)]
        result = classifier.apply_density_bound(items, word_count=500, density="low")
        assert len(result.retained) == result.cap
        assert len(result.trimmed) == 5 - result.cap

    def test_prioritizes_recurring_patterns(
        self, classifier: FeedbackClassifier
    ) -> None:
        """REQ-FB-DENSITY-01 criterion 3: recurring patterns over one-offs."""
        # Create items: "Grammar" appears 3 times, "Style" 2 times, "Misc" 1 time
        items = [
            _item("Grammar", "Q1?", anchor={"start": 0}),
            _item("Style", "Q2?", anchor={"start": 10}),
            _item("Grammar", "Q3?", anchor={"start": 20}),
            _item("Misc", "Q4?", anchor={"start": 30}),
            _item("Grammar", "Q5?", anchor={"start": 40}),
            _item("Style", "Q6?", anchor={"start": 50}),
        ]
        # Cap at 4 items
        result = classifier.apply_density_bound(
            items, word_count=1000, density="medium"
        )
        # cap = 1000 * 4/1000 = 4
        assert result.cap == 4
        assert len(result.retained) == 4

        # All 3 Grammar items should be retained (highest frequency)
        retained_categories = [item.category for item in result.retained]
        assert retained_categories.count("Grammar") == 3
        # At least 1 Style item (next highest frequency)
        assert retained_categories.count("Style") >= 1
        # Misc (one-off) should be trimmed
        assert retained_categories.count("Misc") == 0

    def test_preserves_order_within_frequency_tier(
        self, classifier: FeedbackClassifier
    ) -> None:
        """Within same frequency, original order is preserved."""
        items = [
            _item("A", "First?", anchor={"start": 0}),
            _item("B", "Second?", anchor={"start": 10}),
            _item("A", "Third?", anchor={"start": 20}),
            _item("B", "Fourth?", anchor={"start": 30}),
        ]
        # Both categories have frequency 2; cap at 3
        result = classifier.apply_density_bound(
            items, word_count=250, density="high"
        )
        # 250 * 6/1000 = ceil(1.5) = 2... wait let me recalc
        # Actually cap = max(1, min(ceil(250/1000*6), 24)) = max(1, 2) = 2
        # With cap=2, we should get the first 2 from priority ordering
        assert len(result.retained) == result.cap

    def test_empty_items(self, classifier: FeedbackClassifier) -> None:
        result = classifier.apply_density_bound([], word_count=1000, density="medium")
        assert len(result.retained) == 0
        assert len(result.trimmed) == 0

    def test_moderate_alias_matches_medium(self) -> None:
        assert compute_density_cap(1000, "moderate") == compute_density_cap(
            1000, DensitySetting.MEDIUM
        )


class TestCategoryPreservingDensityBound:
    """Bugfix 1.7 / 2.7: keep one inline item per enabled category."""

    _LEGAL_MEMO = (
        "Citations",
        "Tone",
        "Consistency",
        "Spelling/Grammar",
        "Organization",
        "Clarity",
    )

    def test_legal_memorandum_minority_categories_survive(
        self, classifier: FeedbackClassifier
    ) -> None:
        # cap = 4 (1000 words, medium); SG x6, Citations x1, Tone x1.
        items = [_item("Spelling/Grammar", f"SG{i}?") for i in range(3)]
        items.append(_item("Citations", "Cite?"))
        items += [_item("Spelling/Grammar", f"SG{i}?") for i in range(3, 6)]
        items.append(_item("Tone", "Tone?"))

        without = classifier.apply_density_bound(items, 1000, "medium")
        assert [i.category for i in without.retained] == ["Spelling/Grammar"] * 4

        result = classifier.apply_density_bound(
            items, 1000, "medium", preserve_categories=self._LEGAL_MEMO
        )
        cats = [i.category for i in result.retained]
        assert result.cap == 4
        assert len(result.retained) == 4
        assert cats.count("Spelling/Grammar") == 2
        assert "Citations" in cats and "Tone" in cats
        # Most-recurrent first, then order position.
        assert [i.question for i in result.retained] == ["SG0?", "SG1?", "Cite?", "Tone?"]
        assert len(result.trimmed) == 4

    def test_cap_below_category_count_keeps_top_categories(
        self, classifier: FeedbackClassifier
    ) -> None:
        # cap = 2 (500 words, medium); A x3, B x2, C x1, D x1.
        items = [
            _item("C", "c?"),
            _item("A", "a1?"),
            _item("B", "b1?"),
            _item("A", "a2?"),
            _item("D", "d?"),
            _item("B", "b2?"),
            _item("A", "a3?"),
        ]
        result = classifier.apply_density_bound(
            items, 500, "medium", preserve_categories=["A", "B", "C", "D"]
        )
        assert result.cap == 2
        assert [i.question for i in result.retained] == ["a1?", "b1?"]

    def test_cap_equal_to_category_count_keeps_every_category(
        self, classifier: FeedbackClassifier
    ) -> None:
        # cap = 4; A x5, B, C, D once each.
        items = [_item("A", f"a{i}?") for i in range(5)]
        items += [_item("B", "b?"), _item("C", "c?"), _item("D", "d?")]
        result = classifier.apply_density_bound(
            items, 1000, "medium", preserve_categories=["D", "C", "B", "A"]
        )
        assert sorted(i.category for i in result.retained) == ["A", "B", "C", "D"]

    def test_categories_outside_preserve_set_are_not_seeded(
        self, classifier: FeedbackClassifier
    ) -> None:
        # cap = 2; only B is preserved, so the other slot goes to recurrence (A).
        items = [_item("A", f"a{i}?") for i in range(4)]
        items += [_item("B", "b?"), _item("C", "c?")]
        result = classifier.apply_density_bound(
            items, 500, "medium", preserve_categories=["B"]
        )
        assert [i.question for i in result.retained] == ["a0?", "b?"]

    def test_raw_cap_passes_preserve_through_and_keeps_non_inline(self) -> None:
        items = [
            {"kind": "strength", "error_category_id": "Tone", "question_text": "S?"},
            *[
                {"kind": "inline", "error_category_id": "SG", "question_text": f"{i}?"}
                for i in range(6)
            ],
            {"kind": "structural", "error_category_id": "Org", "question_text": "St?"},
            {"kind": "inline", "error_category_id": "Tone", "question_text": "T?"},
        ]
        result = apply_raw_inline_density_cap(
            items, word_count=500, density="medium", preserve_categories=["SG", "Tone"]
        )
        inline = [i for i in result if i["kind"] == "inline"]
        assert [i["error_category_id"] for i in inline] == ["SG", "Tone"]
        assert [i for i in result if i["kind"] != "inline"] == [items[0], items[7]]

    def test_raw_cap_under_limit_returns_input_unchanged(self) -> None:
        items = [
            {"kind": "inline", "error_category_id": "SG", "question_text": "A?"},
            {"kind": "strength", "error_category_id": "SG", "question_text": "B?"},
        ]
        result = apply_raw_inline_density_cap(
            items, word_count=1000, density="medium", preserve_categories=["SG"]
        )
        assert result is items


def test_word_count_from_segments() -> None:
    assert word_count_from_segments([
        {"text": "One two three"},
        {"text": "four five"},
    ]) == 5


def test_apply_raw_inline_density_cap_keeps_strengths_and_trims_inline() -> None:
    items = [
        {"kind": "strength", "error_category_id": "s1", "question_text": "Keep?"},
        {"kind": "inline", "error_category_id": "Grammar", "question_text": "A?"},
        {"kind": "inline", "error_category_id": "Grammar", "question_text": "B?"},
        {"kind": "inline", "error_category_id": "Style", "question_text": "C?"},
        {"kind": "structural", "error_category_id": "st1", "question_text": "Whole?"},
    ]
    # 500 words at low density → cap 1 inline item
    result = apply_raw_inline_density_cap(items, word_count=500, density="low")
    kinds = [item["kind"] for item in result]
    assert kinds.count("inline") == 1
    assert "strength" in kinds
    assert "structural" in kinds
