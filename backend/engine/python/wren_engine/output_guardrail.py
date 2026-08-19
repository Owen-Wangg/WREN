"""Output no-ghostwriting guardrail for the WREN Feedback Engine (Task 9.4).

Validates raw model output against the no-ghostwriting invariant
(REQ-CORE-NOGHOST-01) before any Feedback Item is persisted or surfaced
to a client. This is the *output* guardrail — it runs *after* model
invocation and *before* persistence, complementing the *input* guardrail
(prompt assembly, Task 9.1) which prevents instructing the model to
produce replacement prose.

The guardrail enforces:

1. **Structure**: each item in the parsed model output MUST contain only
   the allowed fields: ``category``, ``question``, and optionally
   ``anchor`` and ``citation``. Any additional fields (especially
   ``replacement``, ``rewrite``, ``correct_version``, ``suggestion``,
   ``revised_text``, etc.) are stripped.

2. **Content**: the ``question`` field itself is scanned for replacement
   prose patterns — e.g. "Here's a revised version:", "Consider changing
   to:", or a direct rewrite that reads as substitute text. Items that
   fail content validation are rejected entirely (not salvageable by
   stripping, since the question *is* the violation).

3. **Audit**: every stripping/rejection event emits an audit record
   (``GuardrailViolation``) so the Technical Admin can monitor compliance
   drift and tune system scaffolding or the model.

Design references:
  - design.md "No-ghostwriting guardrail (output)": "validates each
    generated item, strips any internal 'correct version'/rewrite, and
    rejects/transforms output that contains replacement prose"
  - requirements.md Requirement 11 criteria 1, 3, 4, 6; Requirement 38
    criterion 3.
  - Property 10: "the persisted Feedback Item ... contain only an error
    category, a Socratic question, an optional anchor, and an optional
    citation — never replacement prose"
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Protocol

__all__ = [
    "GuardrailOutcome",
    "GuardrailViolation",
    "ViolationType",
    "ValidatedFeedbackItem",
    "OutputGuardrail",
    "GuardrailAuditSink",
    "apply_output_guardrail",
]

logger = logging.getLogger(__name__)


class ViolationType(str, Enum):
    """Classification of how a model output violated no-ghostwriting."""

    DISALLOWED_FIELD = "disallowed_field"
    REPLACEMENT_PROSE_IN_QUESTION = "replacement_prose_in_question"
    MALFORMED_ITEM = "malformed_item"
    MISSING_REQUIRED_FIELD = "missing_required_field"


@dataclass(frozen=True, slots=True)
class GuardrailViolation:
    """An individual violation detected in one output item.

    Emitted to the audit sink for compliance monitoring
    (REQ-CORE-NOGHOST-01 criterion 5, REQ-SEC-PROMPTINJECT-01 criterion 4).
    """

    violation_type: ViolationType
    detail: str
    raw_item: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ValidatedFeedbackItem:
    """A feedback item that has passed the no-ghostwriting guardrail.

    Contains only the allowed fields: category, question, and optionally
    anchor, citation, and positive_note. No replacement prose, no rewrites.
    positive_note is set only on strength items (kind="strength") and must
    describe something already present in the document, never a revision.
    """

    category: str
    question: str
    anchor: Optional[dict[str, Any]] = None
    citation: Optional[dict[str, Any]] = None
    positive_note: Optional[str] = None


@dataclass(frozen=True, slots=True)
class GuardrailOutcome:
    """Result of applying the guardrail to the full model output.

    ``accepted`` items passed validation (possibly after field stripping).
    ``violations`` record what was stripped or rejected.
    ``rejected_count`` is the number of items fully rejected (not salvageable).
    ``stripped_count`` is the number of items that had disallowed fields removed.
    """

    accepted: tuple[ValidatedFeedbackItem, ...]
    violations: tuple[GuardrailViolation, ...]
    rejected_count: int
    stripped_count: int


class GuardrailAuditSink(Protocol):
    """Protocol for audit event emission on guardrail violations.

    Production implementations log to the Audit_Service; tests use a
    collecting stub. The sink is called once per guardrail invocation if
    any violations were detected.
    """

    def record_guardrail_violations(
        self,
        violations: list[GuardrailViolation],
        *,
        document_id: Optional[str] = None,
        draft_id: Optional[str] = None,
    ) -> None: ...


# ─── Replacement prose detection ───────────────────────────────────────────────

# Fields that should NEVER appear in a Feedback Item (internal model context
# that must be discarded per REQ-CORE-NOGHOST-01 criteria 3, 4).
_DISALLOWED_FIELDS: frozenset[str] = frozenset(
    {
        "replacement",
        "rewrite",
        "revised",
        "revised_text",
        "revised_version",
        "correct_version",
        "corrected",
        "corrected_text",
        "suggestion",
        "suggested_text",
        "alternative",
        "alternative_text",
        "improved",
        "improved_version",
        "fix",
        "fixed_text",
        "example_revision",
        "better_version",
    }
)

# Patterns in the question text that indicate the model is providing
# replacement prose rather than a Socratic question. These are tested
# case-insensitively.
_REPLACEMENT_PROSE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"\b(?:here(?:'s| is) (?:a |an? )?(?:revised|corrected|improved|better|suggested|alternative) (?:version|text|passage|sentence|paragraph|wording))",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:consider (?:changing|replacing|rewriting|revising) (?:(?:this|it|the (?:sentence|passage|paragraph|text)) )?(?:to|with)[:\s])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:you (?:could|should|might) (?:write|say|phrase|word|rewrite|revise) (?:it|this|the) (?:as|like)[:\s])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:(?:a |the )?(?:better|improved|clearer|more (?:concise|precise|accurate)) (?:way to (?:write|phrase|express|say)(?: (?:this|it|that))?|version|wording) (?:would be|is|might be)[:\s])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:try (?:something like|writing|phrasing|wording)[:\s])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:instead(?:,| you)? (?:write|say|use|try)[:\s])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:(?:suggest(?:ing|ed)?|recommend(?:ing|ed)?) (?:a |this |the )?(?:revision|rewrite|rewording|alternative|change)[:\s])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:the (?:sentence|passage|paragraph|text) (?:could|should|might) (?:be )?(?:rewritten|revised|rephrased|changed) (?:as|to)[:\s])",
        re.IGNORECASE,
    ),
)


def _contains_replacement_prose(text: str) -> bool:
    """Detect whether text contains replacement-prose patterns.

    This is deliberately conservative — it flags clear ghostwriting
    indicators. Borderline Socratic phrasing (e.g. "Could you rephrase
    this?") is NOT flagged because it directs the student to act rather
    than providing a substitute. The key distinction is whether the model
    is *providing* substitute text vs. *asking* the student to produce it.
    """
    return any(pattern.search(text) for pattern in _REPLACEMENT_PROSE_PATTERNS)


# ─── Allowed fields ───────────────────────────────────────────────────────────

_ALLOWED_FIELDS: frozenset[str] = frozenset({"category", "question", "anchor", "citation", "positive_note"})
_REQUIRED_FIELDS: frozenset[str] = frozenset({"category", "question"})


# ─── OutputGuardrail ──────────────────────────────────────────────────────────


class OutputGuardrail:
    """Validates and sanitizes model output before persistence (Task 9.4).

    Pure logic — no I/O, no model calls. Accepts the raw parsed JSON
    output from the model (a list of dicts) and produces a
    :class:`GuardrailOutcome` with only valid, no-ghostwriting-compliant
    items.
    """

    def validate(
        self,
        raw_items: list[dict[str, Any]],
        *,
        audit_sink: Optional[GuardrailAuditSink] = None,
        document_id: Optional[str] = None,
        draft_id: Optional[str] = None,
    ) -> GuardrailOutcome:
        """Apply the no-ghostwriting guardrail to parsed model output.

        Each item is validated independently:
        1. Malformed items (not a dict, or missing required fields) → rejected.
        2. Items with disallowed fields → fields stripped, violation recorded.
        3. Items whose ``question`` contains replacement prose → rejected.
        4. Remaining items are accepted as :class:`ValidatedFeedbackItem`.
        """
        accepted: list[ValidatedFeedbackItem] = []
        violations: list[GuardrailViolation] = []
        rejected_count = 0
        stripped_count = 0

        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                violations.append(
                    GuardrailViolation(
                        violation_type=ViolationType.MALFORMED_ITEM,
                        detail="Item is not a dict/object",
                        raw_item={"_raw": str(raw_item)[:500]},
                    )
                )
                rejected_count += 1
                continue

            # Check required fields
            missing = _REQUIRED_FIELDS - set(raw_item.keys())
            if missing:
                violations.append(
                    GuardrailViolation(
                        violation_type=ViolationType.MISSING_REQUIRED_FIELD,
                        detail=f"Missing required fields: {sorted(missing)}",
                        raw_item=_safe_copy(raw_item),
                    )
                )
                rejected_count += 1
                continue

            # Strip disallowed fields
            disallowed_present = set(raw_item.keys()) & _DISALLOWED_FIELDS
            if disallowed_present:
                for field_name in disallowed_present:
                    violations.append(
                        GuardrailViolation(
                            violation_type=ViolationType.DISALLOWED_FIELD,
                            detail=f"Stripped disallowed field: {field_name!r}",
                            raw_item=_safe_copy(raw_item),
                        )
                    )
                stripped_count += 1

            # Check question content for replacement prose
            question = raw_item.get("question", "")
            if not isinstance(question, str) or not question.strip():
                violations.append(
                    GuardrailViolation(
                        violation_type=ViolationType.MISSING_REQUIRED_FIELD,
                        detail="question field is empty or not a string",
                        raw_item=_safe_copy(raw_item),
                    )
                )
                rejected_count += 1
                continue

            if _contains_replacement_prose(question):
                violations.append(
                    GuardrailViolation(
                        violation_type=ViolationType.REPLACEMENT_PROSE_IN_QUESTION,
                        detail="Question contains replacement prose pattern",
                        raw_item=_safe_copy(raw_item),
                    )
                )
                rejected_count += 1
                continue

            # Check category
            category = raw_item.get("category", "")
            if not isinstance(category, str) or not category.strip():
                violations.append(
                    GuardrailViolation(
                        violation_type=ViolationType.MISSING_REQUIRED_FIELD,
                        detail="category field is empty or not a string",
                        raw_item=_safe_copy(raw_item),
                    )
                )
                rejected_count += 1
                continue

            # Build validated item with only allowed fields
            anchor = raw_item.get("anchor") if "anchor" in raw_item else None
            citation = raw_item.get("citation") if "citation" in raw_item else None
            positive_note_raw = raw_item.get("positive_note")
            positive_note = (
                positive_note_raw.strip()
                if isinstance(positive_note_raw, str) and positive_note_raw.strip()
                else None
            )

            accepted.append(
                ValidatedFeedbackItem(
                    category=category.strip(),
                    question=question.strip(),
                    anchor=anchor if isinstance(anchor, dict) else None,
                    citation=citation if isinstance(citation, dict) else None,
                    positive_note=positive_note,
                )
            )

        # Emit audit events if violations occurred
        if violations and audit_sink is not None:
            audit_sink.record_guardrail_violations(
                violations,
                document_id=document_id,
                draft_id=draft_id,
            )

        return GuardrailOutcome(
            accepted=tuple(accepted),
            violations=tuple(violations),
            rejected_count=rejected_count,
            stripped_count=stripped_count,
        )

    def parse_and_validate(
        self,
        raw_text: str,
        *,
        audit_sink: Optional[GuardrailAuditSink] = None,
        document_id: Optional[str] = None,
        draft_id: Optional[str] = None,
    ) -> GuardrailOutcome:
        """Parse raw model text output as JSON and validate.

        The model is instructed (via system scaffolding) to produce a JSON
        array of items. This method handles common deviations:
        - JSON wrapped in markdown code fences
        - A JSON object with a top-level key containing the array
        - Plain text that cannot be parsed (all items rejected)
        """
        items = _parse_model_output(raw_text)
        return self.validate(
            items,
            audit_sink=audit_sink,
            document_id=document_id,
            draft_id=draft_id,
        )


def apply_output_guardrail(
    feedback_items: list[dict[str, Any]],
    *,
    document_id: Optional[str] = None,
    draft_id: Optional[str] = None,
    audit_sink: Optional[GuardrailAuditSink] = None,
) -> list[dict[str, Any]]:
    """Sanitize engine-shaped items through :class:`OutputGuardrail`.

    Production items use ``error_category_id`` / ``question_text`` / ``kind``.
    ``OutputGuardrail.validate`` requires ``category`` / ``question`` and
    returns ``ValidatedFeedbackItem`` (allowed fields only). This adapter
    maps aliases, validates per item (stable index — duplicates allowed),
    and returns the original persist-shaped dicts with disallowed
    ghostwriting fields stripped. Rejected items are dropped.
    """
    if not feedback_items:
        return []

    guardrail = OutputGuardrail()
    kept: list[dict[str, Any]] = []
    rejected_count = 0
    stripped_count = 0

    for item in feedback_items:
        mapped = {
            **item,
            "category": item.get("error_category_id") or item.get("category", ""),
            "question": item.get("question_text") or item.get("question", ""),
        }
        result = guardrail.validate(
            [mapped],
            audit_sink=audit_sink,
            document_id=document_id,
            draft_id=draft_id,
        )
        rejected_count += result.rejected_count
        stripped_count += result.stripped_count
        if result.accepted:
            kept.append(
                {k: v for k, v in item.items() if k not in _DISALLOWED_FIELDS}
            )

    if rejected_count or stripped_count:
        logger.warning(
            "Output guardrail: kept=%s rejected=%s stripped=%s document_id=%s draft_id=%s",
            len(kept),
            rejected_count,
            stripped_count,
            document_id,
            draft_id,
        )
    return kept


def _parse_model_output(raw_text: str) -> list[dict[str, Any]]:
    """Best-effort JSON array extraction from model output text.

    Models sometimes wrap JSON in markdown fences or return a single object
    with a top-level key. This handles both cases gracefully.
    """
    text = raw_text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json or ```) and last line (```)
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        # Try to find a JSON array in the text
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except (json.JSONDecodeError, ValueError):
                return []
        else:
            return []

    if isinstance(parsed, list):
        return parsed
    elif isinstance(parsed, dict):
        # Look for a top-level key containing an array (e.g. {"items": [...]})
        for value in parsed.values():
            if isinstance(value, list):
                return value
        # Single item wrapped in an object
        return [parsed]
    else:
        return []


def _safe_copy(item: dict[str, Any]) -> dict[str, Any]:
    """Create a safe copy of an item for audit logging, truncating long values."""
    result = {}
    for key, value in item.items():
        if isinstance(value, str) and len(value) > 500:
            result[key] = value[:500] + "..."
        else:
            result[key] = value
    return result
