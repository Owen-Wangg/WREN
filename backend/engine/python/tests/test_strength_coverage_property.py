"""Property tests: strength coverage targets the enabled set E.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 3.8, design C.10).

With a fake fill-in that returns a valid strength for every category it is
asked about, ``handler._ensure_strength_coverage`` must:

- leave every category in ``E`` with a strength item;
- ask the fill-in only for ``E \\ strengths``;
- add nothing outside ``E``;
- make no call when ``E \\ strengths`` is empty;

for both the Step 7c primary item shape and the carry-forward ``cf_as_items``
shape.

**Validates: Requirements 2.6, 2.8, 3.3, 3.8, 3.9**
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from typing import Any

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine.enabled_categories import resolve_enabled_categories  # noqa: E402

_SENTENCE = "The court held that the duty of care applies here."
_SEGMENTS = [{"text": " ".join([_SENTENCE] * 10)}]
_POOL = [str(uuid.uuid5(uuid.NAMESPACE_URL, f"wren-prop/{k}")) for k in range(12)]
_STALE = [str(uuid.uuid5(uuid.NAMESPACE_URL, f"wren-stale/{k}")) for k in range(3)]


@st.composite
def _scenario(draw: st.DrawFn) -> dict[str, Any]:
    size = draw(st.integers(min_value=1, max_value=12))
    taxonomy = _POOL[:size]
    selection = draw(
        st.lists(st.sampled_from(taxonomy + _STALE), unique=True, max_size=size + 2)
    )
    shape = draw(st.sampled_from(["primary", "carry_forward"]))
    specs = draw(
        st.lists(
            st.tuples(
                st.sampled_from(taxonomy),
                st.sampled_from(["inline", "structural", "strength"]),
            ),
            max_size=15,
        )
    )
    return {"taxonomy": taxonomy, "selection": selection, "shape": shape, "specs": specs}


def _make_item(cid: str, kind: str, shape: str, k: int) -> dict[str, Any]:
    item: dict[str, Any] = {
        "error_category_id": cid,
        "kind": kind,
        "question_text": f"How might you revisit point {k} in your draft?",
    }
    if kind == "strength":
        item["positive_note"] = f"Point {k} is handled with care."
    elif shape == "primary":
        item["positive_note"] = None
    if shape == "primary":
        item["anchor"] = {"paragraphIndex": 0, "quotedText": _SENTENCE}
    return item


def _strength_cats(items: list[dict[str, Any]]) -> set[str]:
    return {i["error_category_id"] for i in items if i.get("kind") == "strength"}


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(_scenario())
def test_coverage_fills_exactly_enabled_gaps(scn: dict[str, Any]) -> None:
    taxonomy: list[str] = scn["taxonomy"]
    enabled = resolve_enabled_categories(scn["selection"], taxonomy)
    e_set = set(enabled.ids)

    # Items reaching Step 7c have already passed the selection filter; mirror that.
    items = [
        _make_item(cid, kind, scn["shape"], k)
        for k, (cid, kind) in enumerate(scn["specs"])
        if not enabled.explicit or cid in e_set
    ]
    before = [dict(i) for i in items]
    strengths_before = _strength_cats(items)
    expected_missing = e_set - strengths_before

    calls: list[set[str]] = []

    def fake_invoke(prompt: str, config: dict[str, Any], **kwargs: Any):
        asked = {cid for cid in taxonomy if cid in prompt}
        calls.append(asked)
        return json.dumps([
            {
                "error_category_id": cid,
                "kind": "strength",
                "question_text": "How could you apply this strength elsewhere?",
                "positive_note": "This is done well.",
            }
            for cid in sorted(asked)
        ]), "end_turn"

    original = handler.invoke_bedrock
    handler.invoke_bedrock = fake_invoke
    try:
        handler._ensure_strength_coverage(
            items,
            valid_category_ids=set(taxonomy),
            enabled_category_ids=list(enabled.ids),
            category_ids=list(taxonomy),
            category_names=[f"Category {k}" for k in range(len(taxonomy))],
            segments=_SEGMENTS,
            config={"category_priority": scn["selection"]},
        )
    finally:
        handler.invoke_bedrock = original

    if expected_missing:
        assert calls == [expected_missing]
    else:
        assert calls == []

    # Every enabled category now has a strength.
    assert e_set <= _strength_cats(items)
    # Original items are preserved in order; only new strengths are appended.
    assert [i["error_category_id"] for i in items[: len(before)]] == [
        i["error_category_id"] for i in before
    ]
    added = items[len(before):]
    assert all(i["kind"] == "strength" for i in added)
    assert {i["error_category_id"] for i in added} == expected_missing
    # Nothing outside E is added.
    assert all(i["error_category_id"] in e_set for i in added)
