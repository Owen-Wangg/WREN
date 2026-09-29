"""Handler unit test: strength fill-in budget scales with missing categories.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 3.3, design B.7).
``_ensure_strength_coverage`` must pass ``strength_fill_max_tokens(len(missing))``
to ``invoke_bedrock`` instead of a fixed 2048.

**Validates: Requirements 2.3**
"""
from __future__ import annotations

import inspect
import os
import sys
import uuid
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine.debrief_budget import strength_fill_max_tokens  # noqa: E402

_SENTENCE = "The court held that the duty of care applies here."


def _inline(cid: str, tag: str) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "inline",
        "question_text": f"Can you find other places where issue {tag} appears in your draft?",
        "positive_note": None,
        "anchor": {"paragraphIndex": 0, "quotedText": _SENTENCE},
    }


def _run_coverage(
    monkeypatch: pytest.MonkeyPatch, category_count: int
) -> tuple[list[dict[str, Any]], int]:
    """Run coverage over inline-only items; return fill-in calls and missing count."""
    ids = [str(uuid.uuid4()) for _ in range(category_count)]
    names = [f"Category {k}" for k in range(category_count)]
    # Inline item in every category, no strengths: every category is missing one.
    items = [_inline(cid, str(k)) for k, cid in enumerate(ids)]

    calls: list[dict[str, Any]] = []

    def fake_invoke(prompt: str, config: dict[str, Any], **kwargs: Any):
        calls.append(kwargs)
        return "[]", "end_turn"

    # Explicit full selection: the required set is every category both before
    # and after the secondary fix, so this test only exercises the budget.
    kwargs: dict[str, Any] = {
        "valid_category_ids": set(ids),
        "category_ids": ids,
        "category_names": names,
        "segments": [{"text": " ".join([_SENTENCE] * 10)}],
        "config": {"category_priority": list(ids)},
    }
    params = inspect.signature(handler._ensure_strength_coverage).parameters
    key = "enabled_category_ids" if "enabled_category_ids" in params else "category_priority"
    kwargs[key] = list(ids)

    monkeypatch.setattr(handler, "invoke_bedrock", fake_invoke)
    handler._ensure_strength_coverage(items, **kwargs)
    return calls, category_count


@pytest.mark.parametrize(
    ("category_count", "expected"),
    [(3, 2048), (6, 2048), (7, 2300), (12, 3800)],
)
def test_strength_fill_budget_scales_with_missing_count(
    monkeypatch: pytest.MonkeyPatch, category_count: int, expected: int
) -> None:
    calls, missing = _run_coverage(monkeypatch, category_count)

    assert len(calls) == 1
    assert calls[0]["workload"] == "strength_fill"
    assert calls[0]["max_tokens"] == strength_fill_max_tokens(missing) == expected


def test_no_fill_in_call_when_coverage_complete(monkeypatch: pytest.MonkeyPatch) -> None:
    cid = str(uuid.uuid4())
    items = [
        {
            "error_category_id": cid,
            "kind": "strength",
            "question_text": "How could you apply this strength elsewhere in the memo?",
            "positive_note": "Your handling of this point is precise.",
            "anchor": {"paragraphIndex": 0, "quotedText": _SENTENCE},
        }
    ]
    calls: list[Any] = []
    monkeypatch.setattr(handler, "invoke_bedrock", lambda *a, **k: calls.append(k) or ("[]", "end_turn"))
    params = inspect.signature(handler._ensure_strength_coverage).parameters
    key = "enabled_category_ids" if "enabled_category_ids" in params else "category_priority"
    handler._ensure_strength_coverage(
        items,
        valid_category_ids={cid},
        category_ids=[cid],
        category_names=["Tone"],
        segments=[{"text": _SENTENCE}],
        config={"category_priority": [cid]},
        **{key: [cid]},
    )
    assert calls == []
