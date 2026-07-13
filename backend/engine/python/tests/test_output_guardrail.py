"""Tests for the output no-ghostwriting guardrail (Task 9.4).

Validates that the OutputGuardrail:
- Accepts valid {category, question, anchor?, citation?} items
- Strips disallowed fields (replacement, rewrite, etc.)
- Rejects items with replacement prose in the question
- Rejects malformed items (not dicts, missing required fields)
- Emits audit events on violations
- Parses raw model text (JSON, fenced code blocks, wrapped objects)
"""
import json
from typing import Optional

import pytest

from wren_engine.output_guardrail import (
    GuardrailAuditSink,
    GuardrailOutcome,
    GuardrailViolation,
    OutputGuardrail,
    ValidatedFeedbackItem,
    ViolationType,
    _contains_replacement_prose,
)


# ─── Test helpers ──────────────────────────────────────────────────────────────


class CollectingAuditSink:
    """Test double that collects guardrail violations."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def record_guardrail_violations(
        self,
        violations: list[GuardrailViolation],
        *,
        document_id: Optional[str] = None,
        draft_id: Optional[str] = None,
    ) -> None:
        self.calls.append(
            {
                "violations": violations,
                "document_id": document_id,
                "draft_id": draft_id,
            }
        )


@pytest.fixture
def guardrail() -> OutputGuardrail:
    return OutputGuardrail()


@pytest.fixture
def audit_sink() -> CollectingAuditSink:
    return CollectingAuditSink()


# ─── Valid items ───────────────────────────────────────────────────────────────


class TestAcceptValidItems:
    def test_accepts_minimal_item(self, guardrail: OutputGuardrail) -> None:
        items = [{"category": "Unclear Writing", "question": "Can you clarify this?"}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.accepted[0].category == "Unclear Writing"
        assert result.accepted[0].question == "Can you clarify this?"
        assert result.accepted[0].anchor is None
        assert result.accepted[0].citation is None
        assert result.rejected_count == 0
        assert result.stripped_count == 0

    def test_accepts_item_with_anchor(self, guardrail: OutputGuardrail) -> None:
        items = [
            {
                "category": "Inaccurate Summary",
                "question": "Is this attribution correct?",
                "anchor": {"start": 10, "end": 50, "paragraph": 2},
            }
        ]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.accepted[0].anchor == {"start": 10, "end": 50, "paragraph": 2}

    def test_accepts_item_with_citation(self, guardrail: OutputGuardrail) -> None:
        items = [
            {
                "category": "Missing Citation",
                "question": "What source supports this claim?",
                "citation": {"title": "Smith v. Jones", "section": "para 12"},
            }
        ]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.accepted[0].citation == {
            "title": "Smith v. Jones",
            "section": "para 12",
        }

    def test_accepts_multiple_items(self, guardrail: OutputGuardrail) -> None:
        items = [
            {"category": "A", "question": "Q1?"},
            {"category": "B", "question": "Q2?"},
            {"category": "C", "question": "Q3?"},
        ]
        result = guardrail.validate(items)
        assert len(result.accepted) == 3

    def test_strips_whitespace_from_category_and_question(
        self, guardrail: OutputGuardrail
    ) -> None:
        items = [{"category": "  Unclear Writing  ", "question": "  Can you?  "}]
        result = guardrail.validate(items)
        assert result.accepted[0].category == "Unclear Writing"
        assert result.accepted[0].question == "Can you?"


# ─── Disallowed field stripping ────────────────────────────────────────────────


class TestDisallowedFieldStripping:
    @pytest.mark.parametrize(
        "field_name",
        [
            "replacement",
            "rewrite",
            "revised_text",
            "correct_version",
            "suggestion",
            "alternative",
            "improved_version",
            "fixed_text",
        ],
    )
    def test_strips_disallowed_field(
        self, guardrail: OutputGuardrail, field_name: str
    ) -> None:
        items = [
            {
                "category": "Grammar",
                "question": "Is this grammatically correct?",
                field_name: "The corrected text goes here.",
            }
        ]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.stripped_count == 1
        assert result.accepted[0].category == "Grammar"
        # The disallowed field is NOT in the validated item
        assert not hasattr(result.accepted[0], field_name)

    def test_strips_multiple_disallowed_fields(
        self, guardrail: OutputGuardrail
    ) -> None:
        items = [
            {
                "category": "Style",
                "question": "Could you reconsider this phrasing?",
                "replacement": "Better text",
                "correct_version": "Even better text",
            }
        ]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.stripped_count == 1
        assert len(result.violations) == 2  # One violation per field

    def test_records_violation_on_strip(
        self, guardrail: OutputGuardrail, audit_sink: CollectingAuditSink
    ) -> None:
        items = [
            {
                "category": "X",
                "question": "Q?",
                "rewrite": "Rewritten text",
            }
        ]
        result = guardrail.validate(items, audit_sink=audit_sink)
        assert len(audit_sink.calls) == 1
        assert len(audit_sink.calls[0]["violations"]) == 1
        assert (
            audit_sink.calls[0]["violations"][0].violation_type
            == ViolationType.DISALLOWED_FIELD
        )


# ─── Replacement prose in question ────────────────────────────────────────────


class TestReplacementProseDetection:
    @pytest.mark.parametrize(
        "prose_question",
        [
            "Here's a revised version of the passage: 'The court held...'",
            "Consider changing this to: 'The majority found...'",
            "You could write it as: 'In Villaroman, the SCC...'",
            "A better way to phrase this would be: 'The standard...'",
            "Try something like: 'The Crown's obligation...'",
            "Instead, write: 'The disclosure duty...'",
            "Suggesting a revision: 'The accused need not...'",
            "The sentence could be rewritten as: 'This case establishes...'",
            "Here is an improved version: 'Under Stinchcombe...'",
        ],
    )
    def test_rejects_replacement_prose_in_question(
        self, guardrail: OutputGuardrail, prose_question: str
    ) -> None:
        items = [{"category": "Unclear Writing", "question": prose_question}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 0
        assert result.rejected_count == 1
        assert any(
            v.violation_type == ViolationType.REPLACEMENT_PROSE_IN_QUESTION
            for v in result.violations
        )

    @pytest.mark.parametrize(
        "socratic_question",
        [
            "Can you clarify which legal holding you're referring to here?",
            "What is the main point of this paragraph?",
            "Could you rephrase this to separate the two distinct arguments?",
            "Is this attribution accurate given the court's actual holding?",
            "How does this connect to the argument in your previous paragraph?",
            "What evidence supports this claim?",
            "Have you considered how the reader might interpret this?",
        ],
    )
    def test_accepts_socratic_questions(
        self, guardrail: OutputGuardrail, socratic_question: str
    ) -> None:
        items = [{"category": "Clarity", "question": socratic_question}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.rejected_count == 0


# ─── Malformed items ──────────────────────────────────────────────────────────


class TestMalformedItems:
    def test_rejects_non_dict(self, guardrail: OutputGuardrail) -> None:
        items = ["not a dict", 42, None]  # type: ignore
        result = guardrail.validate(items)
        assert len(result.accepted) == 0
        assert result.rejected_count == 3

    def test_rejects_missing_category(self, guardrail: OutputGuardrail) -> None:
        items = [{"question": "Something?"}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 0
        assert result.rejected_count == 1

    def test_rejects_missing_question(self, guardrail: OutputGuardrail) -> None:
        items = [{"category": "Grammar"}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 0
        assert result.rejected_count == 1

    def test_rejects_empty_question(self, guardrail: OutputGuardrail) -> None:
        items = [{"category": "Grammar", "question": ""}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 0
        assert result.rejected_count == 1

    def test_rejects_empty_category(self, guardrail: OutputGuardrail) -> None:
        items = [{"category": "", "question": "Q?"}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 0
        assert result.rejected_count == 1


# ─── Audit sink integration ───────────────────────────────────────────────────


class TestAuditSink:
    def test_no_audit_call_when_no_violations(
        self, guardrail: OutputGuardrail, audit_sink: CollectingAuditSink
    ) -> None:
        items = [{"category": "X", "question": "Q?"}]
        guardrail.validate(items, audit_sink=audit_sink)
        assert len(audit_sink.calls) == 0

    def test_audit_call_includes_document_and_draft_ids(
        self, guardrail: OutputGuardrail, audit_sink: CollectingAuditSink
    ) -> None:
        items = [{"category": "X", "question": "Q?", "rewrite": "bad"}]
        guardrail.validate(
            items,
            audit_sink=audit_sink,
            document_id="doc-123",
            draft_id="draft-456",
        )
        assert audit_sink.calls[0]["document_id"] == "doc-123"
        assert audit_sink.calls[0]["draft_id"] == "draft-456"

    def test_works_without_audit_sink(self, guardrail: OutputGuardrail) -> None:
        """Guardrail works even without an audit sink (no crash)."""
        items = [{"category": "X", "question": "Q?", "rewrite": "bad"}]
        result = guardrail.validate(items)
        assert len(result.accepted) == 1
        assert result.stripped_count == 1


# ─── parse_and_validate ────────────────────────────────────────────────────────


class TestParseAndValidate:
    def test_parses_json_array(self, guardrail: OutputGuardrail) -> None:
        raw = json.dumps([{"category": "A", "question": "Q?"}])
        result = guardrail.parse_and_validate(raw)
        assert len(result.accepted) == 1

    def test_parses_fenced_json(self, guardrail: OutputGuardrail) -> None:
        raw = '```json\n[{"category": "A", "question": "Q?"}]\n```'
        result = guardrail.parse_and_validate(raw)
        assert len(result.accepted) == 1

    def test_parses_wrapped_object(self, guardrail: OutputGuardrail) -> None:
        raw = json.dumps({"feedback": [{"category": "A", "question": "Q?"}]})
        result = guardrail.parse_and_validate(raw)
        assert len(result.accepted) == 1

    def test_handles_unparseable_text(self, guardrail: OutputGuardrail) -> None:
        raw = "This is not JSON at all, just plain text."
        result = guardrail.parse_and_validate(raw)
        assert len(result.accepted) == 0

    def test_parses_single_object_as_item(self, guardrail: OutputGuardrail) -> None:
        raw = json.dumps({"category": "A", "question": "Q?"})
        result = guardrail.parse_and_validate(raw)
        assert len(result.accepted) == 1


# ─── Replacement prose detection (unit) ────────────────────────────────────────


class TestReplacementProsePatterns:
    def test_does_not_flag_rephrase_request(self) -> None:
        """'Could you rephrase...' is a Socratic directive, not ghostwriting."""
        assert not _contains_replacement_prose("Could you rephrase this more clearly?")

    def test_does_not_flag_consider_question(self) -> None:
        """'Have you considered...' is Socratic."""
        assert not _contains_replacement_prose(
            "Have you considered the reader's perspective?"
        )

    def test_flags_heres_a_revised_version(self) -> None:
        assert _contains_replacement_prose(
            "Here's a revised version of this paragraph: 'The court held...'"
        )

    def test_flags_consider_changing_to(self) -> None:
        assert _contains_replacement_prose(
            "Consider changing this to: 'A more precise formulation...'"
        )

    def test_flags_instead_write(self) -> None:
        assert _contains_replacement_prose("Instead, write: 'The accused...'")

    def test_does_not_flag_normal_question(self) -> None:
        assert not _contains_replacement_prose(
            "What is the main holding of this case?"
        )
