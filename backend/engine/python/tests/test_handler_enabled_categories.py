"""Handler unit tests: enabled set threaded through coverage and quote safety net.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 3.8, design C.10, C.13).

- ``_ensure_strength_coverage`` targets the enabled set on both call-site shapes
  (Step 7c primary items and carry-forward ``cf_as_items``), and logs
  ``strength coverage incomplete`` when fill-in leaves categories uncovered.
- ``_run_quote_safety_net`` offers only enabled categories to the fill-in.

**Validates: Requirements 2.6, 2.8, 2.9, 3.3, 3.12**
"""
from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine.enabled_categories import resolve_enabled_categories  # noqa: E402

_SENTENCE = "The court held that the duty of care applies here."
_NAMES = ["Citations", "Tone", "Consistency", "Spelling/Grammar", "Organization", "Clarity"]
_IDS = [str(uuid.uuid5(uuid.NAMESPACE_URL, f"wren-test/{n}")) for n in _NAMES]
_ID_TO_NAME = dict(zip(_IDS, _NAMES))
_SG = _IDS[_NAMES.index("Spelling/Grammar")]
_SEGMENTS = [{"text": " ".join([_SENTENCE] * 10)}]


def _inline(cid: str, tag: str) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "inline",
        "question_text": f"Can you find other places where issue {tag} appears in your draft?",
        "positive_note": None,
        "anchor": {"paragraphIndex": 0, "quotedText": _SENTENCE},
    }


def _strength_json(cid: str) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "strength",
        "question_text": "How could you apply this strength elsewhere in the memo?",
        "positive_note": "Your handling of this point is precise.",
    }


def _requested_categories(prompt: str) -> set[str]:
    return {cid for cid in _IDS if cid in prompt}


def _fill_fake(calls: list[str], *, answer: bool = True):
    def fake_invoke(prompt: str, config: dict[str, Any], **kwargs: Any):
        calls.append(prompt)
        if not answer:
            return "[]", "end_turn"
        wanted = _requested_categories(prompt)
        return json.dumps([_strength_json(cid) for cid in sorted(wanted)]), "end_turn"

    return fake_invoke


def _run(items: list[dict[str, Any]], selection: list[str]) -> None:
    enabled = resolve_enabled_categories(selection, _IDS)
    handler._ensure_strength_coverage(
        items,
        valid_category_ids=set(_IDS),
        enabled_category_ids=list(enabled.ids),
        category_ids=list(_IDS),
        category_names=list(_NAMES),
        segments=_SEGMENTS,
        config={"category_priority": selection},
    )


def _strength_categories(items: list[dict[str, Any]]) -> set[str]:
    return {i["error_category_id"] for i in items if i.get("kind") == "strength"}


# ── _ensure_strength_coverage ────────────────────────────────────────────────


def test_primary_shape_fills_every_enabled_category(monkeypatch: pytest.MonkeyPatch) -> None:
    selection = [c for c in _IDS if c != _IDS[-1]]  # 5 of 6 enabled
    items = [_inline(_SG, str(k)) for k in range(3)]
    calls: list[str] = []
    monkeypatch.setattr(handler, "invoke_bedrock", _fill_fake(calls))

    _run(items, selection)

    assert len(calls) == 1
    assert _requested_categories(calls[0]) == set(selection)
    assert _strength_categories(items) == set(selection)
    assert _IDS[-1] not in {i["error_category_id"] for i in items}


def test_carry_forward_shape_fills_uncovered_enabled_categories(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # cf_as_items shape: no anchor, optional positive_note, kind from cache.
    cf_as_items = [
        {"error_category_id": _SG, "kind": "strength",
         "question_text": "How could you keep this precision?", "positive_note": "Clean."},
        {"error_category_id": _SG, "kind": "inline",
         "question_text": "Where else does this spelling pattern recur?"},
    ]
    calls: list[str] = []
    monkeypatch.setattr(handler, "invoke_bedrock", _fill_fake(calls))

    _run(cf_as_items, [])  # no selection: E = T

    assert len(calls) == 1
    assert _requested_categories(calls[0]) == set(_IDS) - {_SG}
    assert _strength_categories(cf_as_items) == set(_IDS)


def test_logs_strength_coverage_incomplete_when_fill_returns_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    items = [_inline(_SG, "0")]
    calls: list[str] = []
    monkeypatch.setattr(handler, "invoke_bedrock", _fill_fake(calls, answer=False))

    with caplog.at_level(logging.WARNING, logger=handler.logger.name):
        _run(items, [_SG, _IDS[0]])

    msgs = [r.getMessage() for r in caplog.records if "strength coverage incomplete" in r.getMessage()]
    assert len(msgs) == 1
    assert "Citations" in msgs[0] and "Spelling/Grammar" in msgs[0]
    # Names only: no category UUIDs, no draft text.
    assert _IDS[0] not in msgs[0] and _SENTENCE not in msgs[0]


def test_no_incomplete_warning_when_fill_covers_everything(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    items = [_inline(_SG, "0")]
    monkeypatch.setattr(handler, "invoke_bedrock", _fill_fake([]))
    with caplog.at_level(logging.WARNING, logger=handler.logger.name):
        _run(items, [])
    assert not any("strength coverage incomplete" in r.getMessage() for r in caplog.records)


# ── _run_quote_safety_net ────────────────────────────────────────────────────


def _run_safety_net(
    monkeypatch: pytest.MonkeyPatch, **kwargs: Any
) -> list[str]:
    prompts: list[str] = []

    def fake_invoke(prompt: str, config: dict[str, Any], **kw: Any):
        prompts.append(prompt)
        return "[]", "end_turn"

    monkeypatch.setattr(handler, "_check_quote_coverage", lambda *a, **k: (False, True))
    monkeypatch.setattr(handler, "invoke_bedrock", fake_invoke)
    monkeypatch.setattr(handler, "insert_feedback_items", lambda *a, **k: 0)
    handler._run_quote_safety_net(
        "doc", "draft", "user", _SEGMENTS, {},
        {"category_ids": list(_IDS), "category_names": list(_NAMES)},
        None,
        **kwargs,
    )
    assert len(prompts) == 1
    return prompts


def test_quote_safety_net_lists_only_enabled_categories(monkeypatch: pytest.MonkeyPatch) -> None:
    selection = [_IDS[1], _IDS[3]]
    enabled = resolve_enabled_categories(selection, _IDS)
    (prompt,) = _run_safety_net(monkeypatch, enabled_category_ids=enabled.ids)

    assert _requested_categories(prompt) == set(selection)
    for cid in selection:
        assert _ID_TO_NAME[cid] in prompt
    for cid in set(_IDS) - set(selection):
        assert _ID_TO_NAME[cid] not in prompt


def test_quote_safety_net_no_selection_lists_full_taxonomy(monkeypatch: pytest.MonkeyPatch) -> None:
    enabled = resolve_enabled_categories([], _IDS)
    (with_e,) = _run_safety_net(monkeypatch, enabled_category_ids=enabled.ids)
    (without,) = _run_safety_net(monkeypatch)

    assert _requested_categories(with_e) == set(_IDS)
    assert with_e == without
