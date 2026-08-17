"""Tests for per-category What's Done Well coverage."""
from wren_engine.strength_coverage import (
    accept_filled_strengths,
    build_strength_fill_prompt,
    categories_with_strengths,
    document_text_from_segments,
    missing_strength_categories,
    normalize_feedback_kinds,
    required_strength_categories,
    salvage_strengths_from_positive_notes,
)


ORG = "11111111-1111-1111-1111-111111111111"
CLARITY = "22222222-2222-2222-2222-222222222222"
CONTENT = "33333333-3333-3333-3333-333333333333"


def test_normalize_maps_strength_aliases() -> None:
    items = [
        {"error_category_id": ORG, "kind": "Done_Well", "question_text": "Q"},
        {"error_category_id": CLARITY, "kind": "STRENGTHS", "question_text": "Q"},
    ]
    normalize_feedback_kinds(items)
    assert [item["kind"] for item in items] == ["strength", "strength"]


def test_normalize_promotes_unknown_kind_when_positive_note_present() -> None:
    items = [
        {
            "error_category_id": ORG,
            "kind": "praise",
            "question_text": "Q",
            "positive_note": "Clear issue statement.",
        }
    ]
    normalize_feedback_kinds(items)
    assert items[0]["kind"] == "strength"


def test_normalize_does_not_steal_inline_items_with_notes() -> None:
    items = [
        {
            "error_category_id": ORG,
            "kind": "inline",
            "question_text": "Could this be tighter?",
            "positive_note": "Nice topic sentence.",
        }
    ]
    normalize_feedback_kinds(items)
    assert items[0]["kind"] == "inline"


def test_required_categories_use_priority_and_present_items() -> None:
    items = [{"error_category_id": ORG, "kind": "inline", "question_text": "Q"}]
    required = required_strength_categories(
        items,
        valid_category_ids=[ORG, CLARITY, CONTENT],
        category_priority=[ORG, CLARITY],
    )
    assert required == {ORG, CLARITY}


def test_required_categories_fall_back_to_present_when_no_priority() -> None:
    items = [
        {"error_category_id": ORG, "kind": "inline", "question_text": "Q"},
        {"error_category_id": CLARITY, "kind": "structural", "question_text": "Q"},
    ]
    required = required_strength_categories(
        items,
        valid_category_ids=[ORG, CLARITY, CONTENT],
        category_priority=[],
    )
    assert required == {ORG, CLARITY}


def test_missing_strength_categories_detects_gaps() -> None:
    items = [
        {"error_category_id": ORG, "kind": "strength", "question_text": "Q", "positive_note": "Good IRAC."},
        {"error_category_id": CLARITY, "kind": "inline", "question_text": "Q"},
    ]
    missing = missing_strength_categories(items, {ORG, CLARITY})
    assert missing == {CLARITY}
    assert categories_with_strengths(items) == {ORG}


def test_salvage_copies_note_into_a_strength_and_keeps_the_critique() -> None:
    items = [
        {
            "error_category_id": CLARITY,
            "kind": "inline",
            "question_text": "Could this term confuse a legal reader?",
            "positive_note": "You defined the parties clearly in the opening.",
            "anchor": {"paragraphIndex": 0, "quotedText": "The plaintiff filed suit."},
        }
    ]
    salvage_strengths_from_positive_notes(items)
    assert len(items) == 2
    assert items[0]["kind"] == "inline"
    assert items[0]["positive_note"] is None
    strength = items[1]
    assert strength["kind"] == "strength"
    assert strength["positive_note"] == "You defined the parties clearly in the opening."
    assert strength["anchor"]["quotedText"] == "The plaintiff filed suit."


def test_salvage_skips_categories_that_already_have_a_strength() -> None:
    items = [
        {
            "error_category_id": ORG,
            "kind": "strength",
            "question_text": "How else could you use this?",
            "positive_note": "Headings track IRAC.",
        },
        {
            "error_category_id": ORG,
            "kind": "inline",
            "question_text": "Q",
            "positive_note": "Also good headings.",
        },
    ]
    salvage_strengths_from_positive_notes(items)
    assert len(items) == 2
    assert items[1]["positive_note"] == "Also good headings."


def test_accept_filled_strengths_keeps_one_valid_item_per_missing_category() -> None:
    filled = [
        {
            "error_category_id": CLARITY,
            "kind": "strength",
            "question_text": "How could you reuse this precision?",
            "positive_note": "You named the parties on first reference.",
        },
        {
            "error_category_id": CLARITY,
            "kind": "strength",
            "question_text": "Duplicate",
            "positive_note": "Duplicate note.",
        },
        {
            "error_category_id": ORG,
            "kind": "inline",
            "question_text": "Should not be accepted",
        },
        {
            "error_category_id": CONTENT,
            "kind": "strength",
            "question_text": "Missing note should drop",
        },
    ]
    accepted = accept_filled_strengths(
        filled,
        missing=[CLARITY, CONTENT],
        valid_category_ids=[ORG, CLARITY, CONTENT],
    )
    assert len(accepted) == 1
    assert accepted[0]["error_category_id"] == CLARITY
    assert accepted[0]["positive_note"].startswith("You named")


def test_build_strength_fill_prompt_lists_missing_categories_and_document() -> None:
    prompt = build_strength_fill_prompt(
        document_text=document_text_from_segments(
            [{"text": "The plaintiff filed suit in Ontario."}]
        ),
        missing_categories=[(CLARITY, "Clarity")],
    )
    assert CLARITY in prompt
    assert "Clarity" in prompt
    assert "kind='strength'" in prompt
    assert "The plaintiff filed suit in Ontario." in prompt
    assert "[PARAGRAPH 0]" in prompt


def test_document_text_from_segments_truncates_for_fill_in() -> None:
    segments = [
        {"text": "alpha " * 200},
        {"text": "bravo " * 200},
        {"text": "charlie " * 200},
    ]
    excerpt = document_text_from_segments(segments, max_chars=150, per_paragraph=80)
    assert "[PARAGRAPH 0]" in excerpt
    assert "[PARAGRAPH 2]" not in excerpt
    assert len(excerpt) <= 200
