"""Property test: No-ghostwriting guardrail (Task 9.5 / Property 10).

For any model output (including outputs that embed a corrected version or
rewrite), the persisted Feedback Item and every API payload delivered to a
client contain only an error category, a Socratic question, an optional
anchor, and an optional citation — never replacement prose, a candidate
rewrite, or the internal "correct version".

Validates: Requirements 11.1, 11.3, 11.4, 12.3, 15.4, 38.3

Feature: wren-writing-coach, Property 10
"""
from __future__ import annotations

import json
import string

from hypothesis import given, settings, assume
from hypothesis import strategies as st

import pytest

from wren_engine.output_guardrail import (
    OutputGuardrail,
    ValidatedFeedbackItem,
    ViolationType,
    _DISALLOWED_FIELDS,
)


# ─── Strategies ────────────────────────────────────────────────────────────────

# Valid Socratic questions (no replacement prose)
_socratic_questions = st.sampled_from(
    [
        "Can you clarify the main holding here?",
        "What evidence supports this claim?",
        "How does this connect to your thesis?",
        "Is this attribution accurate?",
        "Could you separate the two distinct arguments?",
        "What is the reader likely to conclude from this phrasing?",
        "Have you considered the counter-argument?",
        "Does this paragraph advance your central thesis?",
        "Is the causal link explicit enough for the reader?",
        "Which legal standard applies here?",
    ]
)

# Replacement prose patterns that MUST be rejected
_replacement_prose_questions = st.sampled_from(
    [
        "Here's a revised version: 'The court held that...'",
        "Consider changing this to: 'A more precise formulation...'",
        "You could write it as: 'The standard of review...'",
        "A better way to phrase this would be: 'Under the doctrine...'",
        "Try something like: 'The accused's rights...'",
        "Instead, write: 'The Crown failed to...'",
        "Suggesting a revision: 'The disclosure obligation...'",
        "The sentence could be rewritten as: 'This establishes...'",
        "Here is an improved version: 'Stinchcombe requires...'",
        "Here's a corrected version of this passage: 'The majority...'",
    ]
)

# Category names
_categories = st.text(
    alphabet=string.ascii_letters + string.digits + " -_",
    min_size=3,
    max_size=40,
).filter(lambda s: s.strip())

# Disallowed field values (internal "correct version" / rewrite content)
_disallowed_content = st.text(min_size=1, max_size=200)

# Anchor data
_anchors = st.one_of(
    st.none(),
    st.fixed_dictionaries(
        {"start": st.integers(0, 10000), "end": st.integers(1, 10001), "paragraph": st.integers(0, 100)}
    ),
)

# Citation data
_citations = st.one_of(
    st.none(),
    st.fixed_dictionaries(
        {"title": st.text(min_size=1, max_size=50), "section": st.text(min_size=1, max_size=30)}
    ),
)


# ─── Property tests ───────────────────────────────────────────────────────────


@pytest.mark.property
class TestNoGhostwritingGuardrailProperty:
    """Property 10: No-ghostwriting guardrail (REQ-CORE-NOGHOST-01)."""

    @settings(max_examples=150)
    @given(
        category=_categories,
        question=_socratic_questions,
        anchor=_anchors,
        citation=_citations,
    )
    def test_valid_items_pass_through_with_only_allowed_fields(
        self, category: str, question: str, anchor, citation
    ) -> None:
        """Valid items (category + Socratic question) always pass the guardrail.

        The persisted item contains ONLY category, question, anchor?, citation?
        (REQ-CORE-NOGHOST-01 criterion 1, Property 10).
        """
        guardrail = OutputGuardrail()
        raw = {"category": category, "question": question}
        if anchor is not None:
            raw["anchor"] = anchor
        if citation is not None:
            raw["citation"] = citation

        result = guardrail.validate([raw])

        assert len(result.accepted) == 1
        item = result.accepted[0]
        # Only allowed fields present
        assert item.category == category.strip()
        assert item.question == question.strip()
        assert item.anchor == anchor
        assert item.citation == citation
        assert result.rejected_count == 0

    @settings(max_examples=150)
    @given(
        category=_categories,
        question=_socratic_questions,
        disallowed_field=st.sampled_from(sorted(_DISALLOWED_FIELDS)),
        disallowed_value=_disallowed_content,
    )
    def test_disallowed_fields_are_always_stripped(
        self, category: str, question: str, disallowed_field: str, disallowed_value: str
    ) -> None:
        """Internal 'correct version' / rewrite fields are ALWAYS stripped.

        The guardrail must discard any field that carries replacement prose
        (REQ-CORE-NOGHOST-01 criteria 3, 4): "SHALL withhold any internal
        correct version or candidate rewrite" and "SHALL exclude it from
        stored Feedback Items".
        """
        guardrail = OutputGuardrail()
        raw = {
            "category": category,
            "question": question,
            disallowed_field: disallowed_value,
        }

        result = guardrail.validate([raw])

        # Item is still accepted (stripping saves it)
        assert len(result.accepted) == 1
        # But the disallowed field is gone
        item = result.accepted[0]
        assert item.category == category.strip()
        assert item.question == question.strip()
        # Violation recorded
        assert result.stripped_count == 1
        assert any(
            v.violation_type == ViolationType.DISALLOWED_FIELD
            for v in result.violations
        )

    @settings(max_examples=100)
    @given(
        category=_categories,
        question=_replacement_prose_questions,
    )
    def test_replacement_prose_in_question_is_always_rejected(
        self, category: str, question: str
    ) -> None:
        """Items whose question IS replacement prose are fully rejected.

        When the model's "question" is actually a rewrite suggestion,
        the item cannot be salvaged by stripping — it must be rejected
        entirely (REQ-CORE-NOGHOST-01 criterion 6).
        """
        guardrail = OutputGuardrail()
        raw = {"category": category, "question": question}

        result = guardrail.validate([raw])

        assert len(result.accepted) == 0
        assert result.rejected_count == 1
        assert any(
            v.violation_type == ViolationType.REPLACEMENT_PROSE_IN_QUESTION
            for v in result.violations
        )

    @settings(max_examples=100)
    @given(
        category=_categories,
        question=_socratic_questions,
        extra_fields=st.dictionaries(
            keys=st.sampled_from(sorted(_DISALLOWED_FIELDS)),
            values=_disallowed_content,
            min_size=1,
            max_size=5,
        ),
    )
    def test_multiple_disallowed_fields_all_stripped(
        self, category: str, question: str, extra_fields: dict
    ) -> None:
        """ALL disallowed fields are stripped, not just the first one.

        Even if the model returns multiple internal fields (e.g. both
        'correct_version' and 'replacement'), every one is stripped and
        a violation recorded for each (REQ-CORE-NOGHOST-01 criterion 4).
        """
        guardrail = OutputGuardrail()
        raw = {"category": category, "question": question, **extra_fields}

        result = guardrail.validate([raw])

        assert len(result.accepted) == 1
        # Each disallowed field generates a violation
        disallowed_violations = [
            v
            for v in result.violations
            if v.violation_type == ViolationType.DISALLOWED_FIELD
        ]
        assert len(disallowed_violations) == len(extra_fields)

    @settings(max_examples=100)
    @given(
        n_valid=st.integers(0, 10),
        n_invalid=st.integers(0, 10),
    )
    def test_mixed_batch_only_valid_items_persist(
        self, n_valid: int, n_invalid: int
    ) -> None:
        """In a mixed batch, only guardrail-passing items are persisted.

        The guardrail processes each item independently. Valid items are
        not affected by invalid siblings (REQ-SEC-PROMPTINJECT-01
        criterion 3: "reject or sanitize the output before it is stored").
        """
        assume(n_valid + n_invalid > 0)
        guardrail = OutputGuardrail()

        items = []
        for i in range(n_valid):
            items.append({"category": f"Cat{i}", "question": f"Is this correct {i}?"})
        for i in range(n_invalid):
            items.append(
                {
                    "category": f"Bad{i}",
                    "question": f"Here's a revised version: 'Text {i}'",
                }
            )

        result = guardrail.validate(items)

        assert len(result.accepted) == n_valid
        assert result.rejected_count == n_invalid
        # All accepted items have only the allowed shape
        for item in result.accepted:
            assert isinstance(item.category, str) and item.category
            assert isinstance(item.question, str) and item.question
