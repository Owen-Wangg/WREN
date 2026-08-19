"""Tests for the engine-field adapter around OutputGuardrail."""
from wren_engine.output_guardrail import apply_output_guardrail


_CATEGORY_ID = "11111111-1111-1111-1111-111111111111"


def test_accepts_engine_shaped_item_and_preserves_persist_fields() -> None:
    items = [
        {
            "error_category_id": _CATEGORY_ID,
            "question_text": "Can you clarify which holding you mean here?",
            "kind": "inline",
            "anchor": {"paragraphIndex": 0, "quotedText": "The court held"},
            "positive_note": None,
        }
    ]
    kept = apply_output_guardrail(items, document_id="doc-1", draft_id="draft-1")
    assert len(kept) == 1
    assert kept[0]["error_category_id"] == _CATEGORY_ID
    assert kept[0]["question_text"] == "Can you clarify which holding you mean here?"
    assert kept[0]["kind"] == "inline"
    assert kept[0]["anchor"] == {"paragraphIndex": 0, "quotedText": "The court held"}


def test_strips_disallowed_replacement_field_but_keeps_item() -> None:
    items = [
        {
            "error_category_id": _CATEGORY_ID,
            "question_text": "What evidence supports this claim?",
            "kind": "inline",
            "replacement": "The court held that disclosure is required.",
        }
    ]
    kept = apply_output_guardrail(items)
    assert len(kept) == 1
    assert "replacement" not in kept[0]
    assert kept[0]["kind"] == "inline"
    assert kept[0]["error_category_id"] == _CATEGORY_ID


def test_drops_item_with_replacement_prose_in_question_text() -> None:
    items = [
        {
            "error_category_id": _CATEGORY_ID,
            "question_text": "Here's a revised version of the passage: 'The court held...'",
            "kind": "inline",
        }
    ]
    kept = apply_output_guardrail(items)
    assert kept == []


def test_keeps_clean_item_when_mixed_with_ghostwritten() -> None:
    items = [
        {
            "error_category_id": _CATEGORY_ID,
            "question_text": "Here's a revised version of the passage: 'The court held...'",
            "kind": "inline",
        },
        {
            "error_category_id": _CATEGORY_ID,
            "question_text": "What is the main point of this paragraph?",
            "kind": "strength",
        },
    ]
    kept = apply_output_guardrail(items)
    assert len(kept) == 1
    assert kept[0]["kind"] == "strength"
    assert kept[0]["question_text"] == "What is the main point of this paragraph?"


def test_empty_input_returns_empty() -> None:
    assert apply_output_guardrail([]) == []
