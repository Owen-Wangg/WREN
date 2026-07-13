"""Property test: Classification within configured taxonomy (Task 9.7 / Property 14).

For any Document Type taxonomy configuration, every generated Feedback Item's
error category belongs to that type's configured categories (never a hardcoded
enumeration).

Validates: Requirements 15.1

Feature: wren-writing-coach, Property 14
"""
from __future__ import annotations

import string

from hypothesis import given, settings, assume
from hypothesis import strategies as st

import pytest

from wren_engine.feedback_classifier import FeedbackClassifier
from wren_engine.output_guardrail import ValidatedFeedbackItem


# ─── Strategies ────────────────────────────────────────────────────────────────

# Category name generator — realistic category strings
_category_name = st.text(
    alphabet=string.ascii_letters + string.digits + " -_",
    min_size=2,
    max_size=50,
).filter(lambda s: s.strip())

# Taxonomy: a non-empty tuple of distinct category names
_taxonomy = st.lists(
    _category_name,
    min_size=1,
    max_size=20,
    unique_by=lambda s: s.lower().strip(),
).map(tuple)

# Out-of-taxonomy categories (guaranteed to not be in a given taxonomy)
_out_of_taxonomy_suffix = st.text(
    alphabet=string.ascii_letters,
    min_size=5,
    max_size=15,
)


def _make_item(category: str) -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(
        category=category,
        question="Is this correct?",
        anchor=None,
        citation=None,
    )


# ─── Property tests ───────────────────────────────────────────────────────────


@pytest.mark.property
class TestClassificationWithinTaxonomyProperty:
    """Property 14: Classification stays within configured taxonomy."""

    @settings(max_examples=150)
    @given(taxonomy=_taxonomy)
    def test_items_with_configured_categories_always_accepted(
        self, taxonomy: tuple[str, ...]
    ) -> None:
        """Items whose category is in the configured taxonomy are always accepted.

        REQ-TAXONOMY-01 criterion 1: "THE Feedback_Engine SHALL classify
        issues using the active Document Type's configured categories."
        """
        classifier = FeedbackClassifier()

        # Create items with categories drawn from the taxonomy
        items = [_make_item(cat) for cat in taxonomy]
        result = classifier.filter_by_taxonomy(items, taxonomy)

        assert len(result.accepted) == len(taxonomy)
        assert len(result.rejected) == 0

    @settings(max_examples=150)
    @given(taxonomy=_taxonomy)
    def test_case_insensitive_matching_always_accepts(
        self, taxonomy: tuple[str, ...]
    ) -> None:
        """Case variations of configured categories are always accepted.

        The model may return "unclear writing" when the taxonomy has
        "Unclear Writing" — this must still match.
        """
        classifier = FeedbackClassifier()

        # Create items with various case mutations
        items = []
        for cat in taxonomy:
            items.append(_make_item(cat.upper()))
            items.append(_make_item(cat.lower()))

        result = classifier.filter_by_taxonomy(items, taxonomy)

        assert len(result.accepted) == len(items)
        assert len(result.rejected) == 0

    @settings(max_examples=150)
    @given(taxonomy=_taxonomy, suffix=_out_of_taxonomy_suffix)
    def test_out_of_taxonomy_categories_always_rejected(
        self, taxonomy: tuple[str, ...], suffix: str
    ) -> None:
        """Categories NOT in the configured taxonomy are always rejected.

        This ensures the engine never uses a hardcoded enumeration — only
        the active Document Type's configured categories are valid
        (REQ-TAXONOMY-01 criterion 1).
        """
        classifier = FeedbackClassifier()

        # Create a category guaranteed to not be in taxonomy
        fake_category = f"__NONEXISTENT_{suffix}__"
        assume(fake_category.lower().strip() not in {c.lower().strip() for c in taxonomy})

        items = [_make_item(fake_category)]
        result = classifier.filter_by_taxonomy(items, taxonomy)

        assert len(result.accepted) == 0
        assert len(result.rejected) == 1

    @settings(max_examples=150)
    @given(taxonomy=_taxonomy)
    def test_accepted_items_have_canonical_category_name(
        self, taxonomy: tuple[str, ...]
    ) -> None:
        """Accepted items carry the canonical (configured) category name.

        Even if the model returns a case-variant, the output uses the
        Department-Admin-configured canonical form.
        """
        classifier = FeedbackClassifier()

        # Use lowercase versions as input
        items = [_make_item(cat.lower()) for cat in taxonomy]
        result = classifier.filter_by_taxonomy(items, taxonomy)

        for item, original_cat in zip(result.accepted, taxonomy):
            # The accepted category should be the canonical (configured) form
            assert item.category == original_cat

    @settings(max_examples=100)
    @given(
        taxonomy=_taxonomy,
        n_valid=st.integers(1, 10),
        n_invalid=st.integers(1, 10),
        suffix=_out_of_taxonomy_suffix,
    )
    def test_mixed_batch_partitions_correctly(
        self, taxonomy: tuple[str, ...], n_valid: int, n_invalid: int, suffix: str
    ) -> None:
        """A mixed batch of in-taxonomy and out-of-taxonomy items partitions cleanly.

        Valid items are accepted, invalid ones rejected — independently.
        """
        classifier = FeedbackClassifier()

        fake_category = f"__NONEXISTENT_{suffix}__"
        assume(fake_category.lower().strip() not in {c.lower().strip() for c in taxonomy})

        # Build items: some valid (cycling through taxonomy), some invalid
        valid_items = [_make_item(taxonomy[i % len(taxonomy)]) for i in range(n_valid)]
        invalid_items = [_make_item(fake_category) for _ in range(n_invalid)]
        all_items = valid_items + invalid_items

        result = classifier.filter_by_taxonomy(all_items, taxonomy)

        assert len(result.accepted) == n_valid
        assert len(result.rejected) == n_invalid

    @settings(max_examples=100)
    @given(
        items_data=st.lists(
            st.tuples(_category_name, st.booleans()),
            min_size=1,
            max_size=15,
        )
    )
    def test_empty_taxonomy_accepts_all(self, items_data: list) -> None:
        """When no taxonomy is configured, ALL categories are accepted.

        An empty taxonomy means the Department Admin hasn't restricted
        categories yet — the engine is permissive by default.
        """
        classifier = FeedbackClassifier()
        items = [_make_item(cat) for cat, _ in items_data]

        result = classifier.filter_by_taxonomy(items, ())

        assert len(result.accepted) == len(items)
        assert len(result.rejected) == 0
