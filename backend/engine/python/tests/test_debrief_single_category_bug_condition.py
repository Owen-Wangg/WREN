"""Bug condition exploration tests: debrief collapses to a single category.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 1).

**Property 1: Bug Condition** - Budget, Prompt, and Coverage Do Not Match the
Enabled Categories.

These tests encode the EXPECTED (fixed) behavior. On the unfixed engine they
FAIL, and the failures are the counterexamples that prove the bug exists:

Primary (1.1-1.5):
  1. budgetShort   - ``debrief_max_tokens`` assumes ~150 tokens/item.
  2. budget count  - the handler sizes the budget from |T|, not |E|.
  3. promptLeak    - the prompt taxonomy / criteria list deselected categories.
  4/5. silentGap   - no warning when enabled categories lack improvement items.

Secondary (1.6-1.10):
  6. coverageGap (empty selection)   7. coverageGap (carry-forward)
  8. densityCollapse                 9. staleCollapse

The enabled set ``E`` is computed inline (the resolver does not exist yet):
``E = S ∩ T`` in selection order, or ``T`` when ``S = ∅`` or ``S ∩ T = ∅``.

The bug is deterministic, so Hypothesis varies only incidental data (UUIDs,
item text, ordering) around the concrete Legal Memorandum cases.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10,
2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10**
"""
from __future__ import annotations

import copy
import inspect
import json
import logging
import os
import sys
from dataclasses import dataclass
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine import feedback_classifier  # noqa: E402
from wren_engine.debrief_budget import debrief_max_tokens  # noqa: E402
from wren_engine.strength_coverage import required_strength_categories  # noqa: E402


# --------------------------------------------------------------------------- #
# Constants and fixtures                                                      #
# --------------------------------------------------------------------------- #

OBSERVED_TOKENS_PER_ITEM = 230
_FIXED_TOKENS_PER_ITEM = 300
_FIXED_OVERHEAD = 200
_MIN_BUDGET = 2560
_MAX_BUDGET = 6144

CATEGORY_NAMES: tuple[str, ...] = (
    "Citations",
    "Tone",
    "Consistency",
    "Spelling/Grammar",
    "Organization",
    "Clarity",
)
DESELECTED = "Organization"  # F: the category the admin switched off
SG = "Spelling/Grammar"

_SENTENCE = "The court held that the duty of care applies here."  # 10 words
# 20 paragraphs x 100 words = 2000 words -> medium density cap = 8.
_SEGMENTS: list[dict[str, Any]] = [
    {"text": " ".join([_SENTENCE] * 10)} for _ in range(20)
]
_INLINE_CAP = 8

_PBT_SETTINGS = settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@dataclass(frozen=True)
class Taxonomy:
    ids: tuple[str, ...]
    names: tuple[str, ...]

    def id_of(self, name: str) -> str:
        return self.ids[self.names.index(name)]

    def name_of(self, cid: str) -> str:
        return self.names[self.ids.index(cid)]


taxonomies = st.lists(st.uuids(), min_size=6, max_size=6, unique=True).map(
    lambda us: Taxonomy(ids=tuple(str(u) for u in us), names=CATEGORY_NAMES)
)


def expected_enabled(selection: list[Any] | None, taxonomy_ids: list[Any] | None) -> list[str]:
    """Inline reference for E (the resolver is not imported on purpose)."""

    def _clean(values: list[Any] | None) -> list[str]:
        out: list[str] = []
        for value in values or []:
            if value is None:
                continue
            text = str(value).strip()
            if text and text not in out:
                out.append(text)
        return out

    s = _clean(selection)
    t = _clean(taxonomy_ids)
    if not t:
        return s
    if not s:
        return t
    kept = [c for c in s if c in set(t)]
    return kept or t


def fixed_budget(inline_cap: int, category_count: int) -> int:
    """Expected ``debrief_max_tokens`` after the fix (~300 tokens/item)."""
    requested = max(1, inline_cap) + max(category_count, 1) + 2
    return min(
        _MAX_BUDGET,
        max(_MIN_BUDGET, requested * _FIXED_TOKENS_PER_ITEM + _FIXED_OVERHEAD),
    )


def original_budget(inline_cap: int, category_count: int) -> int:
    requested = max(1, inline_cap) + max(category_count, 1) + 2
    return min(_MAX_BUDGET, max(_MIN_BUDGET, requested * 150 + 200))


# --------------------------------------------------------------------------- #
# Item builders                                                               #
# --------------------------------------------------------------------------- #


def strength(cid: str, tag: str = "") -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "strength",
        "question_text": f"How could you apply this strength{tag} elsewhere in the memo?",
        "positive_note": "Your handling of this point is precise and well supported.",
        "anchor": {"paragraphIndex": 0, "quotedText": _SENTENCE},
    }


def inline(cid: str, n: int) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "inline",
        "question_text": (
            f"Can you find other places where issue number {n} appears in your draft?"
        ),
        "positive_note": None,
        "anchor": {"paragraphIndex": n % len(_SEGMENTS), "quotedText": _SENTENCE},
    }


def _config(selection: list[str], *, density_description: str = "") -> dict[str, Any]:
    return {
        "category_priority": list(selection),
        "density": "medium",
        "tone": "supportive",
        "type_prompt_text": "Review this legal memorandum.",
        "density_description": density_description,
        "updated_at": None,
    }


def _meta(tax: Taxonomy) -> dict[str, Any]:
    return {
        "name": "Legal Memorandum",
        "category_ids": list(tax.ids),
        "category_names": list(tax.names),
        "category_guidance": {},
    }


# --------------------------------------------------------------------------- #
# process_feedback_request harness                                            #
# --------------------------------------------------------------------------- #


class _FakeConn:
    def rollback(self) -> None:  # pragma: no cover - only on error paths
        pass

    def commit(self) -> None:  # pragma: no cover
        pass

    def close(self) -> None:
        pass


@dataclass
class JobCapture:
    primary_calls: list[dict[str, Any]]
    fill_calls: list[dict[str, Any]]
    inserted: list[list[dict[str, Any]]]

    @property
    def persisted(self) -> list[dict[str, Any]]:
        return [item for batch in self.inserted for item in batch]


def run_job(
    monkeypatch: pytest.MonkeyPatch,
    *,
    tax: Taxonomy,
    selection: list[str],
    model_output: str,
    stop_reason: str,
) -> JobCapture:
    """Drive ``process_feedback_request`` with DB loaders and model calls faked."""
    capture = JobCapture(primary_calls=[], fill_calls=[], inserted=[])
    config = _config(selection)
    meta = _meta(tax)

    def fake_cached(structured, cfg, *, max_tokens=None, workload="feedback_primary"):
        capture.primary_calls.append(
            {"prompt": structured.render(), "max_tokens": max_tokens, "workload": workload}
        )
        return model_output, stop_reason

    def fake_invoke(prompt, cfg, *, max_tokens=None, workload="feedback_primary"):
        capture.fill_calls.append(
            {"prompt": prompt, "max_tokens": max_tokens, "workload": workload}
        )
        return "[]", "end_turn"

    def fake_insert(document_id, draft_id, user_id, items, segments, conn, wipe_existing=True):
        capture.inserted.append(copy.deepcopy(list(items)))
        return len(items)

    with monkeypatch.context() as mp:
        mp.setattr(handler, "get_db_connection", lambda: _FakeConn())
        mp.setattr(handler, "load_prompt_config", lambda _wt, _c: copy.deepcopy(config))
        mp.setattr(handler, "load_document_type_meta", lambda _wt, _c: copy.deepcopy(meta))
        mp.setattr(handler, "load_department_prompt", lambda _wt, _c: "")
        mp.setattr(handler, "load_draft_segments", lambda _d, _c: copy.deepcopy(_SEGMENTS))
        mp.setattr(handler, "load_draft_footnotes", lambda _d, _c: [])
        mp.setattr(handler, "load_reference_material", lambda _wt: [])
        mp.setattr(handler, "_load_prior_cached_items", lambda *a, **k: ([], None))
        mp.setattr(handler, "invoke_bedrock_cached", fake_cached)
        mp.setattr(handler, "invoke_bedrock", fake_invoke)
        mp.setattr(handler, "insert_feedback_items", fake_insert)
        mp.setattr(handler, "persist_resolution_status", lambda *a, **k: None)
        mp.setattr(handler, "_check_quote_coverage", lambda *a, **k: (True, True))
        mp.setattr(handler, "update_aggregate_counters", lambda *a, **k: None)
        mp.setattr(handler, "publish_debrief_ready", lambda *a, **k: None)
        handler.process_feedback_request(
            "job-1", "doc-1", "draft-1", "user-1", "doctype-legal-memo"
        )
    return capture


def _gap_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.WARNING
        and "debrief improvement coverage gap" in record.getMessage()
    ]


def _selection_without(tax: Taxonomy, name: str, order: list[int]) -> list[str]:
    ids = [cid for cid in tax.ids if cid != tax.id_of(name)]
    return [ids[i] for i in order]


# =========================================================================== #
# Primary cases                                                               #
# =========================================================================== #


# Case 1 (budgetShort, 1.1-1.3) ---------------------------------------------- #
@pytest.mark.parametrize(
    ("inline_cap", "category_count", "old_budget"),
    [(4, 6, 2560), (8, 6, 2600), (9, 6, 2750), (12, 6, 3200)],
)
def test_case1_budget_covers_observed_per_item_cost(
    inline_cap: int, category_count: int, old_budget: int
) -> None:
    assert original_budget(inline_cap, category_count) == old_budget
    requested = max(1, inline_cap) + max(category_count, 1) + 2
    budget = debrief_max_tokens(inline_cap=inline_cap, category_count=category_count)

    assert budget >= 1.4 * old_budget, (
        f"debrief_max_tokens({inline_cap}, {category_count}) == {budget} "
        f"< 1.4 x {old_budget}"
    )
    assert budget >= min(_MAX_BUDGET, requested * OBSERVED_TOKENS_PER_ITEM), (
        f"debrief_max_tokens({inline_cap}, {category_count}) == {budget} "
        f"< {requested} items x {OBSERVED_TOKENS_PER_ITEM} tokens"
    )
    assert budget <= _MAX_BUDGET
    assert budget == fixed_budget(inline_cap, category_count)


# Case 2 (budget from enabled count, 2.1) ------------------------------------ #
@_PBT_SETTINGS
@given(tax=taxonomies, order=st.permutations(range(5)))
def test_case2_primary_budget_uses_enabled_category_count(
    monkeypatch: pytest.MonkeyPatch, tax: Taxonomy, order: list[int]
) -> None:
    selection = _selection_without(tax, DESELECTED, list(order))
    enabled = expected_enabled(selection, list(tax.ids))
    assert len(enabled) == 5

    items = [strength(cid) for cid in enabled] + [inline(tax.id_of(SG), 1)]
    capture = run_job(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=json.dumps(items),
        stop_reason="end_turn",
    )

    assert len(capture.primary_calls) == 1
    expected = fixed_budget(_INLINE_CAP, len(enabled))
    assert expected == 4700
    assert capture.primary_calls[0]["max_tokens"] == expected, (
        f"primary max_tokens == {capture.primary_calls[0]['max_tokens']}, "
        f"expected debrief_max_tokens({_INLINE_CAP}, |E|={len(enabled)}) == {expected}"
    )


# Case 3 (promptLeak, 1.5) --------------------------------------------------- #
def _taxonomy_lines(rendered: str) -> list[str]:
    marker = "Only these are valid:"
    start = rendered.index("## Feedback taxonomy")
    after = rendered[rendered.index(marker, start) + len(marker):]
    lines: list[str] = []
    for line in after.split("\n")[1:]:
        if not line.startswith("  "):
            break
        lines.append(line)
    return lines


def _criteria_blocks(rendered: str) -> list[str]:
    header = "Per-category evaluation criteria:\n"
    if header not in rendered:
        return []
    after = rendered[rendered.index(header) + len(header):]
    blocks: list[str] = []
    for chunk in after.split("\n\n"):
        if not chunk.startswith("["):
            break
        blocks.append(chunk.split("\nReference grounding:")[0])
    return blocks


@_PBT_SETTINGS
@given(tax=taxonomies, order=st.permutations(range(5)))
def test_case3_deselected_category_absent_from_prompt(
    tax: Taxonomy, order: list[int]
) -> None:
    deselected_id = tax.id_of(DESELECTED)
    selection = _selection_without(tax, DESELECTED, list(order))
    enabled = expected_enabled(selection, list(tax.ids))
    overrides = {
        cid: {
            "definition": f"Definition for {name}.",
            "criteria": f"Success criteria for {name}.",
        }
        for cid, name in zip(tax.ids, tax.names)
    }
    config = _config(selection, density_description=json.dumps({"v": 1, "overrides": overrides}))

    rendered = handler.build_structured_prompt(
        config, _meta(tax), "", copy.deepcopy(_SEGMENTS), []
    ).render()

    taxonomy = _taxonomy_lines(rendered)
    taxonomy_text = "\n".join(taxonomy)
    criteria = _criteria_blocks(rendered)
    criteria_text = "\n\n".join(criteria)

    for cid in enabled:
        assert f"  {cid}: {tax.name_of(cid)}" in taxonomy, (
            f"enabled category {tax.name_of(cid)} missing from taxonomy block"
        )
    assert deselected_id not in taxonomy_text, (
        f"taxonomy block lists deselected {DESELECTED} ({deselected_id}): {taxonomy}"
    )
    assert DESELECTED not in taxonomy_text
    assert deselected_id not in criteria_text
    assert f"[{DESELECTED}]" not in criteria_text, (
        f"criteria blocks define deselected {DESELECTED}: "
        f"{[b.splitlines()[0] for b in criteria]}"
    )


# Cases 4 and 5 (silentGap, 1.2, 1.4) ---------------------------------------- #
def _gap_scenario(tax: Taxonomy, sg_count: int, strength_order: list[int]):
    """6 strengths (strength-first), then Spelling/Grammar inline items."""
    strengths = [strength(tax.ids[i]) for i in strength_order]
    sg_items = [inline(tax.id_of(SG), n) for n in range(sg_count)]
    return strengths, sg_items


def _assert_gap_logged(
    caplog: pytest.LogCaptureFixture,
    capture: JobCapture,
    *,
    tax: Taxonomy,
    enabled: list[str],
    sg_items: list[dict[str, Any]],
    stop_reason: str,
) -> None:
    persisted_improvements = [
        item["question_text"]
        for item in capture.persisted
        if item.get("kind") in {"inline", "structural"}
    ]
    assert persisted_improvements == [item["question_text"] for item in sg_items], (
        "improvement items were invented or lost"
    )

    gap_names = [tax.name_of(cid) for cid in enabled if cid != tax.id_of(SG)]
    warnings = _gap_warnings(caplog)
    assert len(warnings) == 1, (
        f"expected one 'debrief improvement coverage gap' warning naming {gap_names} "
        f"with stop_reason={stop_reason!r}; got {warnings}"
    )
    message = warnings[0]
    for name in gap_names:
        assert name in message, f"gap warning does not name {name}: {message}"
    assert stop_reason in message


@_PBT_SETTINGS
@given(
    tax=taxonomies,
    order=st.permutations(range(5)),
    strength_order=st.permutations(range(6)),
    sg_count=st.integers(min_value=1, max_value=4),
)
def test_case4_improvement_gap_logged_on_truncation(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    tax: Taxonomy,
    order: list[int],
    strength_order: list[int],
    sg_count: int,
) -> None:
    caplog.clear()
    caplog.set_level(logging.INFO)
    selection = _selection_without(tax, DESELECTED, list(order))
    enabled = expected_enabled(selection, list(tax.ids))
    strengths, sg_items = _gap_scenario(tax, sg_count, list(strength_order))

    complete = json.dumps(strengths + sg_items)
    # Cut off mid-object before any closing brace, as a max_tokens stop does.
    truncated = (
        complete[:-1]
        + ', {"error_category_id": "'
        + tax.id_of("Tone")
        + '", "kind": "inline", "question_text": "Is th'
    )

    capture = run_job(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=truncated,
        stop_reason="max_tokens",
    )
    _assert_gap_logged(
        caplog, capture, tax=tax, enabled=enabled, sg_items=sg_items, stop_reason="max_tokens"
    )


@_PBT_SETTINGS
@given(
    tax=taxonomies,
    order=st.permutations(range(5)),
    strength_order=st.permutations(range(6)),
    sg_count=st.integers(min_value=1, max_value=4),
)
def test_case5_improvement_gap_logged_on_complete_response(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    tax: Taxonomy,
    order: list[int],
    strength_order: list[int],
    sg_count: int,
) -> None:
    caplog.clear()
    caplog.set_level(logging.INFO)
    selection = _selection_without(tax, DESELECTED, list(order))
    enabled = expected_enabled(selection, list(tax.ids))
    strengths, sg_items = _gap_scenario(tax, sg_count, list(strength_order))

    capture = run_job(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=json.dumps(strengths + sg_items),
        stop_reason="end_turn",
    )
    _assert_gap_logged(
        caplog, capture, tax=tax, enabled=enabled, sg_items=sg_items, stop_reason="end_turn"
    )


# =========================================================================== #
# Secondary cases                                                             #
# =========================================================================== #


# Case 6 (coverageGap, empty selection, 1.6) --------------------------------- #
@_PBT_SETTINGS
@given(tax=taxonomies, sg_count=st.integers(min_value=1, max_value=5))
def test_case6_empty_selection_requires_every_taxonomy_category(
    tax: Taxonomy, sg_count: int
) -> None:
    sg = tax.id_of(SG)
    items = [strength(sg)] + [inline(sg, n) for n in range(sg_count)]
    required = required_strength_categories(
        items, valid_category_ids=list(tax.ids), category_priority=[]
    )
    assert required == set(expected_enabled([], list(tax.ids))) == set(tax.ids), (
        f"required_strength_categories(SG-only, T, []) == "
        f"{sorted(tax.name_of(c) for c in required)}, expected all of T"
    )


# Case 7 (coverageGap on carry-forward, 1.8) --------------------------------- #
_FILL_HEADER = "Categories that still need a strength item:\n"


def _requested_fill_categories(prompt: str) -> set[str]:
    after = prompt.split(_FILL_HEADER, 1)[1]
    requested: set[str] = set()
    for line in after.split("\n"):
        if not line.startswith("  "):
            break
        requested.add(line.strip().split(":", 1)[0])
    return requested


def _call_ensure_strength_coverage_like_fast_path(
    items: list[dict[str, Any]], *, tax: Taxonomy, config: dict[str, Any]
) -> None:
    """Call ``_ensure_strength_coverage`` the way the carry-forward fast path does.

    Today the fast path passes the raw ``category_priority``; after the fix it
    passes the enabled set as ``enabled_category_ids``. Pick whichever the
    current signature accepts so the test exercises the real call shape.
    """
    params = inspect.signature(handler._ensure_strength_coverage).parameters
    kwargs: dict[str, Any] = {
        "valid_category_ids": set(tax.ids),
        "category_ids": list(tax.ids),
        "category_names": list(tax.names),
        "segments": copy.deepcopy(_SEGMENTS),
        "config": config,
    }
    if "enabled_category_ids" in params:
        kwargs["enabled_category_ids"] = expected_enabled(
            config.get("category_priority"), list(tax.ids)
        )
    else:
        kwargs["category_priority"] = list(config.get("category_priority", []))
    handler._ensure_strength_coverage(items, **kwargs)


@_PBT_SETTINGS
@given(tax=taxonomies, sg_count=st.integers(min_value=1, max_value=4))
def test_case7_carry_forward_fill_in_targets_uncovered_enabled_categories(
    monkeypatch: pytest.MonkeyPatch, tax: Taxonomy, sg_count: int
) -> None:
    sg = tax.id_of(SG)
    config = _config([])
    # cf_as_items shape: category, kind, question (+ positive_note on strengths).
    cf_as_items: list[dict[str, Any]] = [
        {
            "error_category_id": sg,
            "kind": "strength",
            "question_text": "How could you keep this precision throughout?",
            "positive_note": "Your spelling is consistently careful.",
        }
    ] + [
        {
            "error_category_id": sg,
            "kind": "inline",
            "question_text": f"Can you find other instances of issue {n}?",
        }
        for n in range(sg_count)
    ]
    enabled = expected_enabled([], list(tax.ids))
    expected_missing = set(enabled) - {sg}
    assert len(expected_missing) == 5

    fill_calls: list[dict[str, Any]] = []

    def fake_invoke(prompt, cfg, *, max_tokens=None, workload="feedback_primary"):
        fill_calls.append({"prompt": prompt, "max_tokens": max_tokens, "workload": workload})
        wanted = _requested_fill_categories(prompt)
        return json.dumps([strength(cid, f" ({cid[:4]})") for cid in sorted(wanted)]), "end_turn"

    with monkeypatch.context() as mp:
        mp.setattr(handler, "invoke_bedrock", fake_invoke)
        _call_ensure_strength_coverage_like_fast_path(cf_as_items, tax=tax, config=config)

    requested: set[str] = set()
    for call in fill_calls:
        requested |= _requested_fill_categories(call["prompt"])
    assert requested == expected_missing, (
        f"fill-in requested {sorted(tax.name_of(c) for c in requested)}, expected "
        f"{sorted(tax.name_of(c) for c in expected_missing)}"
    )


# Case 8 (densityCollapse, 1.7) ---------------------------------------------- #
def _density_trim_like_handler(
    items: list[dict[str, Any]], *, enabled: list[str], word_count: int
) -> list[dict[str, Any]]:
    """Call the raw density trim the way the handler does (post-fix: with E)."""
    fn = feedback_classifier.apply_raw_inline_density_cap
    kwargs: dict[str, Any] = {"word_count": word_count, "density": "medium"}
    if "preserve_categories" in inspect.signature(fn).parameters:
        kwargs["preserve_categories"] = enabled
    return fn(items, **kwargs)


@_PBT_SETTINGS
@given(tax=taxonomies, order=st.permutations(range(8)))
def test_case8_density_trim_keeps_minority_categories(
    tax: Taxonomy, order: list[int]
) -> None:
    word_count = 1000  # medium density -> cap 4
    cap = feedback_classifier.compute_density_cap(word_count, "medium")
    assert cap == 4

    pool = (
        [inline(tax.id_of(SG), n) for n in range(6)]
        + [inline(tax.id_of("Citations"), 6)]
        + [inline(tax.id_of("Tone"), 7)]
    )
    items = [pool[i] for i in order]
    enabled = expected_enabled([], list(tax.ids))

    kept = _density_trim_like_handler(items, enabled=enabled, word_count=word_count)
    kept_inline = [item for item in kept if item.get("kind") == "inline"]
    kept_names = [tax.name_of(item["error_category_id"]) for item in kept_inline]

    assert len(kept_inline) <= cap
    assert "Citations" in kept_names and "Tone" in kept_names, (
        f"cap={cap} with SGx6, Citationsx1, Tonex1 kept only {kept_names}"
    )


# Case 9 (staleCollapse, 1.10) ----------------------------------------------- #
@_PBT_SETTINGS
@given(
    tax=taxonomies,
    stale=st.lists(st.uuids(), min_size=2, max_size=2, unique=True),
)
def test_case9_stale_only_selection_keeps_valid_items(
    monkeypatch: pytest.MonkeyPatch, tax: Taxonomy, stale: list
) -> None:
    selection = [str(u) for u in stale]
    if set(selection) & set(tax.ids):  # pragma: no cover - astronomically unlikely
        return
    enabled = expected_enabled(selection, list(tax.ids))
    assert enabled == list(tax.ids)

    valid_inline = [inline(tax.id_of("Citations"), 1), inline(tax.id_of("Tone"), 2)]
    items = [strength(cid) for cid in tax.ids] + valid_inline
    capture = run_job(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=json.dumps(items),
        stop_reason="end_turn",
    )

    persisted = capture.persisted
    persisted_questions = {item["question_text"] for item in persisted}
    assert persisted, (
        f"stale-only selection {selection} dropped every valid item "
        f"({len(items)} parsed, 0 persisted)"
    )
    for item in valid_inline:
        assert item["question_text"] in persisted_questions
    assert {item["error_category_id"] for item in persisted} <= set(enabled)
