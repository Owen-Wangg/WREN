"""Tests for document-wide structural feedback (Task 9.9).

Validates that the StructuralFeedbackProcessor:
- Partitions items into inline (anchored) vs structural (non-anchored)
- Marks structural items with is_structural=True
- Applies a separate structural cap
- Does not apply to inline items (they have their own density cap)
- Structural items have anchor=None
"""
import pytest

from wren_engine.output_guardrail import ValidatedFeedbackItem
from wren_engine.structural_feedback import (
    DEFAULT_STRUCTURAL_CAP,
    FeedbackPartition,
    StructuralFeedbackItem,
    StructuralFeedbackProcessor,
)


def _inline_item(category: str = "Grammar", question: str = "Q?") -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(
        category=category,
        question=question,
        anchor={"start": 0, "end": 10, "paragraph": 1},
        citation=None,
    )


def _structural_item(
    category: str = "Organization", question: str = "Q?"
) -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(
        category=category,
        question=question,
        anchor=None,
        citation=None,
    )


@pytest.fixture
def processor() -> StructuralFeedbackProcessor:
    return StructuralFeedbackProcessor()


# ─── Partitioning ─────────────────────────────────────────────────────────────


class TestPartition:
    def test_separates_inline_from_structural(
        self, processor: StructuralFeedbackProcessor
    ) -> None:
        items = [
            _inline_item("Grammar", "Inline Q1?"),
            _structural_item("Organization", "Structural Q1?"),
            _inline_item("Clarity", "Inline Q2?"),
            _structural_item("Coherence", "Structural Q2?"),
        ]
        result = processor.partition(items)
        assert len(result.inline_items) == 2
        assert len(result.structural_items) == 2

    def test_inline_items_have_anchors(
        self, processor: StructuralFeedbackProcessor
    ) -> None:
        items = [_inline_item("Grammar", "Q?")]
        result = processor.partition(items)
        assert result.inline_items[0].anchor is not None

    def test_structural_items_are_marked(
        self, processor: StructuralFeedbackProcessor
    ) -> None:
        items = [_structural_item("Organization", "How is this structured?")]
        result = processor.partition(items)
        assert len(result.structural_items) == 1
        assert result.structural_items[0].is_structural is True
        assert result.structural_items[0].category == "Organization"
        assert result.structural_items[0].question == "How is this structured?"

    def test_all_inline(self, processor: StructuralFeedbackProcessor) -> None:
        items = [_inline_item() for _ in range(5)]
        result = processor.partition(items)
        assert len(result.inline_items) == 5
        assert len(result.structural_items) == 0

    def test_all_structural(self, processor: StructuralFeedbackProcessor) -> None:
        items = [_structural_item(f"Cat{i}") for i in range(3)]
        result = processor.partition(items)
        assert len(result.inline_items) == 0
        assert len(result.structural_items) == 3

    def test_empty_input(self, processor: StructuralFeedbackProcessor) -> None:
        result = processor.partition([])
        assert len(result.inline_items) == 0
        assert len(result.structural_items) == 0

    def test_preserves_citation_on_structural(
        self, processor: StructuralFeedbackProcessor
    ) -> None:
        items = [
            ValidatedFeedbackItem(
                category="Research",
                question="Does the overall argument align with the reference?",
                anchor=None,
                citation={"title": "Guide", "section": "Ch 3"},
            )
        ]
        result = processor.partition(items)
        assert result.structural_items[0].citation == {
            "title": "Guide",
            "section": "Ch 3",
        }


# ─── Structural cap ───────────────────────────────────────────────────────────


class TestStructuralCap:
    def test_applies_default_cap(self) -> None:
        processor = StructuralFeedbackProcessor()
        assert processor.structural_cap == DEFAULT_STRUCTURAL_CAP
        items = [_structural_item(f"Cat{i}", f"Q{i}?") for i in range(10)]
        result = processor.partition(items)
        assert len(result.structural_items) == DEFAULT_STRUCTURAL_CAP

    def test_custom_cap(self) -> None:
        processor = StructuralFeedbackProcessor(structural_cap=3)
        items = [_structural_item(f"Cat{i}", f"Q{i}?") for i in range(7)]
        result = processor.partition(items)
        assert len(result.structural_items) == 3

    def test_cap_preserves_order(self) -> None:
        """Retains first N structural items (model's priority ordering)."""
        processor = StructuralFeedbackProcessor(structural_cap=2)
        items = [
            _structural_item("First", "Q1?"),
            _structural_item("Second", "Q2?"),
            _structural_item("Third", "Q3?"),
        ]
        result = processor.partition(items)
        assert result.structural_items[0].category == "First"
        assert result.structural_items[1].category == "Second"

    def test_does_not_cap_inline_items(self) -> None:
        """Structural cap does NOT affect inline items."""
        processor = StructuralFeedbackProcessor(structural_cap=2)
        items = [_inline_item(f"Cat{i}") for i in range(10)]
        result = processor.partition(items)
        assert len(result.inline_items) == 10

    def test_zero_cap(self) -> None:
        processor = StructuralFeedbackProcessor(structural_cap=0)
        items = [_structural_item()]
        result = processor.partition(items)
        assert len(result.structural_items) == 0

    def test_negative_cap_raises(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            StructuralFeedbackProcessor(structural_cap=-1)


# ─── from_raw_structural_items ─────────────────────────────────────────────────


class TestFromRawStructuralItems:
    def test_converts_all_items(
        self, processor: StructuralFeedbackProcessor
    ) -> None:
        items = [
            ValidatedFeedbackItem(
                category="Organization", question="Q?", anchor=None, citation=None
            ),
            ValidatedFeedbackItem(
                category="Coherence", question="Q2?", anchor=None, citation=None
            ),
        ]
        result = processor.from_raw_structural_items(items)
        assert len(result) == 2
        assert all(item.is_structural for item in result)

    def test_applies_cap(self, processor: StructuralFeedbackProcessor) -> None:
        items = [
            ValidatedFeedbackItem(
                category=f"Cat{i}", question=f"Q{i}?", anchor=None, citation=None
            )
            for i in range(20)
        ]
        result = processor.from_raw_structural_items(items)
        assert len(result) == DEFAULT_STRUCTURAL_CAP


# ─── StructuralFeedbackItem validation ─────────────────────────────────────────


class TestStructuralFeedbackItemValidation:
    def test_empty_category_raises(self) -> None:
        with pytest.raises(ValueError, match="category must not be empty"):
            StructuralFeedbackItem(category="", question="Q?")

    def test_empty_question_raises(self) -> None:
        with pytest.raises(ValueError, match="question must not be empty"):
            StructuralFeedbackItem(category="Org", question="")

    def test_whitespace_only_category_raises(self) -> None:
        with pytest.raises(ValueError, match="category must not be empty"):
            StructuralFeedbackItem(category="   ", question="Q?")

    def test_valid_item(self) -> None:
        item = StructuralFeedbackItem(
            category="Organization",
            question="Does the document flow logically?",
        )
        assert item.is_structural is True
        assert item.category == "Organization"
