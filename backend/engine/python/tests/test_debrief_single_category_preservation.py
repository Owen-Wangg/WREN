"""Preservation property tests: debrief single-category feedback fix.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 2).

**Property 2: Preservation** - Non-Buggy Jobs and Unchanged Semantics.

Written observation-first against the UNFIXED engine: every expectation below
is the behavior the current code already exhibits, so these tests PASS before
the fix and must keep passing after it.

Frozen reference copies of the original ``debrief_max_tokens``,
``required_strength_categories`` and
``FeedbackClassifier._prioritize_by_recurrence`` live in this module so the
fixed code can be compared against the pre-fix behavior directly.

Hypothesis inputs are restricted to jobs where ``isBugCondition`` (design.md)
is false. :func:`bug_condition_clauses` evaluates each clause; generators are
built to stay out of the bug domain and the tests assert that they do. The one
documented exception is the explicit-selection filter test (3.3): on the
unfixed engine any strict subset ``S ⊊ T`` trips ``promptLeak``, which concerns
prompt bytes only. That test checks persisted items, and asserts every other
clause is false.

Golden no-selection prompt renders (3.15) are stored in
``tests/fixtures/debrief_no_selection_prompts.json``. They were captured on
the unfixed engine with ``_generate_boundary_token`` patched. To recapture
(only ever on known-good code) run::

    python tests/test_debrief_single_category_preservation.py --write-golden

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10,
3.11, 3.12, 3.13, 3.14, 3.15, 3.16**
"""
from __future__ import annotations

import copy
import inspect
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from unittest import mock

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine import prompt_assembly  # noqa: E402
from wren_engine.debrief_budget import (  # noqa: E402
    MAX_DEBRIEF_MAX_TOKENS,
    MIN_DEBRIEF_MAX_TOKENS,
    debrief_max_tokens,
)
from wren_engine.feedback_classifier import (  # noqa: E402
    FeedbackClassifier,
    apply_raw_inline_density_cap,
    compute_density_cap,
    word_count_from_segments,
)
from wren_engine.feedback_job_result import (  # noqa: E402
    NonRetryableFeedbackError,
    TruncatedFeedbackError,
)
from wren_engine.footnote_metadata import FootnoteMetadata  # noqa: E402
from wren_engine.output_guardrail import ValidatedFeedbackItem  # noqa: E402
from wren_engine.strength_coverage import required_strength_categories  # noqa: E402


# =========================================================================== #
# Frozen reference copies of the ORIGINAL (pre-fix) implementations           #
# =========================================================================== #


def original_debrief_max_tokens(*, inline_cap: int, category_count: int) -> int:
    """Frozen copy of ``debrief_max_tokens`` before the fix (150 tokens/item)."""
    estimated_items = max(1, inline_cap) + max(category_count, 1) + 2
    return min(6144, max(2560, estimated_items * 150 + 200))


def original_required_strength_categories(
    items: Iterable[dict[str, Any]],
    *,
    valid_category_ids: Iterable[str] | None = None,
    category_priority: Iterable[str] | None = None,
) -> set[str]:
    """Frozen copy of ``required_strength_categories`` before the fix."""

    def _cid(item: dict[str, Any]) -> str:
        return str(item.get("error_category_id") or item.get("category") or "").strip()

    present = {_cid(item) for item in items if _cid(item)}
    priority = {str(c).strip() for c in (category_priority or []) if str(c).strip()}
    required = priority | present
    valid = {str(c).strip() for c in (valid_category_ids or []) if str(c).strip()}
    if valid:
        required &= valid
        required |= present & valid
    return {cid for cid in required if cid}


def original_prioritize_by_recurrence(items: list[Any], cap: int) -> list[Any]:
    """Frozen copy of ``FeedbackClassifier._prioritize_by_recurrence``."""
    counts: Counter[str] = Counter(item.category for item in items)
    scored = [(counts[item.category], idx, item) for idx, item in enumerate(items)]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [item for _, _, item in scored]


def original_apply_density_bound(
    items: list[Any], word_count: int, density: str
) -> tuple[list[Any], list[Any], int]:
    """Frozen ``apply_density_bound`` built on the frozen prioritizer."""
    cap = compute_density_cap(word_count, density)
    if len(items) <= cap:
        return list(items), [], cap
    retained = original_prioritize_by_recurrence(list(items), cap)[:cap]
    kept = {id(item) for item in retained}
    return retained, [item for item in items if id(item) not in kept], cap


def original_raw_inline_density_cap(
    items: list[dict[str, Any]], *, word_count: int, density: str
) -> list[dict[str, Any]]:
    """Frozen ``apply_raw_inline_density_cap`` built on the frozen prioritizer."""
    inline_items = [item for item in items if item.get("kind") == "inline"]
    if not inline_items:
        return items
    wrappers = [
        ValidatedFeedbackItem(
            category=str(item.get("error_category_id") or ""),
            question=str(item.get("question_text") or ""),
        )
        for item in inline_items
    ]
    retained, trimmed, _cap = original_apply_density_bound(wrappers, word_count, density)
    if not trimmed:
        return items
    kept_wrappers = {id(w) for w in retained}
    kept_items = {
        id(item) for w, item in zip(wrappers, inline_items) if id(w) in kept_wrappers
    }
    return [i for i in items if i.get("kind") != "inline" or id(i) in kept_items]


# =========================================================================== #
# Bug condition (design.md isBugCondition), evaluated clause by clause        #
# =========================================================================== #

OBSERVED_TOKENS_PER_ITEM = 230

_KIND_ALIASES: dict[str, str] = {
    "strength": "strength",
    "strengths": "strength",
    "done_well": "strength",
    "donewell": "strength",
    "whats_done_well": "strength",
    "affirmation": "strength",
    "positive": "strength",
    "inline": "inline",
    "structural": "structural",
    "structure": "structural",
}


def _clean_ids(values: Iterable[Any] | None) -> list[str]:
    out: list[str] = []
    for value in values or []:
        if value is None:
            continue
        text = str(value).strip()
        if text and text not in out:
            out.append(text)
    return out


def expected_enabled(selection: Iterable[Any] | None, taxonomy: Iterable[Any] | None) -> list[str]:
    """Inline reference for E: ``S ∩ T``, or ``T`` when ``S = ∅`` or ``S ∩ T = ∅``."""
    s, t = _clean_ids(selection), _clean_ids(taxonomy)
    if not t:
        return s
    if not s:
        return t
    kept = [c for c in s if c in set(t)]
    return kept or t


def _effective_kind(item: dict[str, Any]) -> str:
    raw = item.get("kind")
    key = raw.strip().lower() if isinstance(raw, str) else ""
    if key in _KIND_ALIASES:
        return _KIND_ALIASES[key]
    note = item.get("positive_note")
    if isinstance(note, str) and note.strip():
        return "strength"
    return "inline" if not key else key


def _category(item: dict[str, Any]) -> str:
    return str(item.get("error_category_id") or "").strip()


def bug_condition_clauses(
    *,
    selection: list[str],
    taxonomy: list[str],
    inline_cap: int,
    recovered_items: list[dict[str, Any]],
) -> dict[str, bool]:
    """Evaluate each ``isBugCondition`` clause against the UNFIXED engine.

    ``promptLeak`` uses the unfixed prompt's shape (the taxonomy block always
    lists every ``T`` category). ``silentGap`` is any gap, because the unfixed
    engine never logs one.
    """
    enabled = expected_enabled(selection, taxonomy)
    s, t = _clean_ids(selection), _clean_ids(taxonomy)
    explicit = bool(set(s) & set(t))
    requested = max(1, inline_cap) + max(len(enabled), 1) + 2
    budget_orig = original_debrief_max_tokens(inline_cap=inline_cap, category_count=len(t))

    improved = {
        _category(i)
        for i in recovered_items
        if _effective_kind(i) in {"inline", "structural"}
    }
    strengths = {_category(i) for i in recovered_items if _effective_kind(i) == "strength"}
    r_orig = original_required_strength_categories(
        recovered_items, valid_category_ids=t, category_priority=s
    )

    inline_items = [i for i in recovered_items if _effective_kind(i) == "inline"]
    inline_cats = {_category(i) for i in inline_items if _category(i) in set(enabled)}
    wrappers = [ValidatedFeedbackItem(category=_category(i), question="q") for i in inline_items]
    trimmed_cats = {
        w.category for w in original_prioritize_by_recurrence(wrappers, inline_cap)[:inline_cap]
    }

    return {
        "budgetShort": budget_orig < min(6144, requested * OBSERVED_TOKENS_PER_ITEM),
        "promptLeak": explicit and bool(set(t) - set(enabled)),
        "silentGap": any(c not in improved for c in enabled),
        "coverageGap": any(c not in r_orig and c not in strengths for c in enabled),
        "staleCollapse": bool(s) and not (set(s) & set(t)),
        "densityCollapse": (
            len(inline_items) > inline_cap
            and inline_cap >= len(inline_cats)
            and any(c not in trimmed_cats for c in inline_cats)
        ),
    }


def is_bug_condition(**kwargs: Any) -> bool:
    return any(bug_condition_clauses(**kwargs).values())


# =========================================================================== #
# Fixtures, strategies, item builders                                         #
# =========================================================================== #

_NAME_POOL: tuple[str, ...] = (
    "Citations",
    "Tone",
    "Consistency",
    "Spelling/Grammar",
    "Organization",
    "Clarity",
    "Argument",
    "Research",
)

_SENTENCE = "The court held that the duty of care applies here."  # 10 words


def make_segments(paragraphs: int) -> list[dict[str, Any]]:
    """``paragraphs`` x 100 words."""
    return [{"text": " ".join([_SENTENCE] * 10)} for _ in range(paragraphs)]


# Short drafts keep the medium density cap at 1-3 and the original budget at
# the 2560 floor, which already fits the requested items (NOT budgetShort).
_SHORT_PARAGRAPH_COUNTS = (2, 5, 7)  # 200 / 500 / 700 words -> cap 1 / 2 / 3

_PBT = settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
_PBT_PIPELINE = settings(
    max_examples=15,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)


@dataclass(frozen=True)
class Taxonomy:
    ids: tuple[str, ...]
    names: tuple[str, ...]

    def name_of(self, cid: str) -> str:
        return self.names[self.ids.index(cid)]


def taxonomies(min_size: int = 1, max_size: int = 6) -> st.SearchStrategy[Taxonomy]:
    @st.composite
    def _build(draw: st.DrawFn) -> Taxonomy:
        n = draw(st.integers(min_value=min_size, max_value=max_size))
        ids = draw(st.lists(st.uuids(), min_size=n, max_size=n, unique=True))
        names = draw(st.permutations(_NAME_POOL))[:n]
        return Taxonomy(ids=tuple(str(u) for u in ids), names=tuple(names))

    return _build()


def strength(cid: str, tag: str = "") -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "strength",
        "question_text": f"How could you apply this strength {tag}elsewhere in the memo?",
        "positive_note": "Your handling of this point is precise and well supported.",
        "anchor": {"paragraphIndex": 0, "quotedText": _SENTENCE},
    }


def structural(cid: str, tag: str) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "structural",
        "question_text": f"How does the overall structure support point {tag} of your analysis?",
        "positive_note": None,
    }


def inline(cid: str, tag: str) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "inline",
        "question_text": f"Can you find other places where issue {tag} appears in your draft?",
        "positive_note": None,
        "anchor": {"paragraphIndex": 0, "quotedText": _SENTENCE},
    }


def _config(selection: list[str], **extra: Any) -> dict[str, Any]:
    config: dict[str, Any] = {
        "category_priority": list(selection),
        "density": "medium",
        "tone": "supportive",
        "type_prompt_text": "Review this legal memorandum.",
        "density_description": "",
        "updated_at": None,
    }
    config.update(extra)
    return config


def _meta(tax: Taxonomy, guidance: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "name": "Legal Memorandum",
        "category_ids": list(tax.ids),
        "category_names": list(tax.names),
        "category_guidance": dict(guidance or {}),
    }


# =========================================================================== #
# process_feedback_request harness                                            #
# =========================================================================== #


class _FakeConn:
    def rollback(self) -> None:
        pass

    def commit(self) -> None:  # pragma: no cover
        pass

    def close(self) -> None:
        pass


@dataclass
class JobCapture:
    primary_calls: list[dict[str, Any]]
    secondary_calls: list[dict[str, Any]]
    inserted: list[list[dict[str, Any]]]

    @property
    def persisted(self) -> list[dict[str, Any]]:
        return [item for batch in self.inserted for item in batch]

    def calls(self, workload: str) -> list[dict[str, Any]]:
        return [c for c in self.secondary_calls if c["workload"] == workload]


def run_pipeline(
    monkeypatch: pytest.MonkeyPatch,
    *,
    tax: Taxonomy,
    selection: list[str],
    model_output: str,
    stop_reason: str,
    segments: list[dict[str, Any]],
    quote_coverage: tuple[bool, bool] = (True, True),
) -> JobCapture:
    """Drive ``process_feedback_request`` with DB loaders and model calls faked."""
    capture = JobCapture(primary_calls=[], secondary_calls=[], inserted=[])
    config = _config(selection)
    meta = _meta(tax)

    def fake_cached(structured, cfg, *, max_tokens=None, workload="feedback_primary"):
        capture.primary_calls.append(
            {"prompt": structured.render(), "max_tokens": max_tokens, "workload": workload}
        )
        return model_output, stop_reason

    def fake_invoke(prompt, cfg, *, max_tokens=None, workload="feedback_primary"):
        capture.secondary_calls.append(
            {"prompt": prompt, "max_tokens": max_tokens, "workload": workload}
        )
        return "[]", "end_turn"

    def fake_insert(document_id, draft_id, user_id, items, segs, conn, wipe_existing=True):
        capture.inserted.append(copy.deepcopy(list(items)))
        return len(items)

    with monkeypatch.context() as mp:
        mp.setattr(handler, "get_db_connection", lambda: _FakeConn())
        mp.setattr(handler, "load_prompt_config", lambda _wt, _c: copy.deepcopy(config))
        mp.setattr(handler, "load_document_type_meta", lambda _wt, _c: copy.deepcopy(meta))
        mp.setattr(handler, "load_department_prompt", lambda _wt, _c: "")
        mp.setattr(handler, "load_draft_segments", lambda _d, _c: copy.deepcopy(segments))
        mp.setattr(handler, "load_draft_footnotes", lambda _d, _c: [])
        mp.setattr(handler, "load_reference_material", lambda _wt: [])
        mp.setattr(handler, "_load_prior_cached_items", lambda *a, **k: ([], None))
        mp.setattr(handler, "invoke_bedrock_cached", fake_cached)
        mp.setattr(handler, "invoke_bedrock", fake_invoke)
        mp.setattr(handler, "insert_feedback_items", fake_insert)
        mp.setattr(handler, "persist_resolution_status", lambda *a, **k: None)
        mp.setattr(handler, "_check_quote_coverage", lambda *a, **k: quote_coverage)
        mp.setattr(handler, "update_aggregate_counters", lambda *a, **k: None)
        mp.setattr(handler, "publish_debrief_ready", lambda *a, **k: None)
        handler.process_feedback_request(
            "job-1", "doc-1", "draft-1", "user-1", "doctype-legal-memo"
        )
    return capture


def _call_ensure_strength_coverage(
    items: list[dict[str, Any]], *, tax: Taxonomy, selection: list[str]
) -> None:
    """Call ``_ensure_strength_coverage`` with whichever signature is current.

    Unfixed: ``category_priority`` (raw selection). Fixed: ``enabled_category_ids``.
    """
    params = inspect.signature(handler._ensure_strength_coverage).parameters
    kwargs: dict[str, Any] = {
        "valid_category_ids": set(tax.ids),
        "category_ids": list(tax.ids),
        "category_names": list(tax.names),
        "segments": make_segments(2),
        "config": _config(selection),
    }
    if "enabled_category_ids" in params:
        kwargs["enabled_category_ids"] = expected_enabled(selection, list(tax.ids))
    else:
        kwargs["category_priority"] = list(selection)
    handler._ensure_strength_coverage(items, **kwargs)


@st.composite
def non_bug_jobs(draw: st.DrawFn, *, explicit_full: bool | None = None):
    """A job outside the bug domain: no or full selection, short draft,
    every enabled category with a strength and an improvement, inline <= cap."""
    tax = draw(taxonomies())
    full = draw(st.booleans()) if explicit_full is None else explicit_full
    selection = list(draw(st.permutations(tax.ids))) if full else []
    paragraphs = draw(st.sampled_from(_SHORT_PARAGRAPH_COUNTS))
    segments = make_segments(paragraphs)
    cap = compute_density_cap(word_count_from_segments(segments), "medium")
    enabled = expected_enabled(selection, list(tax.ids))

    strength_order = draw(st.permutations(enabled))
    items = [strength(c, f"{k} ") for k, c in enumerate(strength_order)]
    items += [structural(c, f"s{k}") for k, c in enumerate(enabled)]
    n_inline = draw(st.integers(min_value=0, max_value=cap))
    items += [
        inline(draw(st.sampled_from(enabled)), f"i{k}") for k in range(n_inline)
    ]
    return tax, selection, segments, cap, items


# =========================================================================== #
# 3.15 Golden no-selection prompt bytes                                       #
# =========================================================================== #

_GOLDEN_PATH = Path(__file__).parent / "fixtures" / "debrief_no_selection_prompts.json"
_FIXED_BOUNDARY = "0123456789abcdef0123456789abcdef"

_GOLDEN_TAX = Taxonomy(
    ids=(
        "a1a1a1a1-0000-4000-8000-000000000001",
        "a1a1a1a1-0000-4000-8000-000000000002",
        "a1a1a1a1-0000-4000-8000-000000000003",
        "a1a1a1a1-0000-4000-8000-000000000004",
        "a1a1a1a1-0000-4000-8000-000000000005",
        "a1a1a1a1-0000-4000-8000-000000000006",
    ),
    names=_NAME_POOL[:6],
)


def _golden_variants() -> dict[str, dict[str, Any]]:
    tax = _GOLDEN_TAX
    overrides = json.dumps(
        {
            "v": 1,
            "overrides": {
                tax.ids[0]: {"definition": "Pinpoint every authority.", "criteria": "Every cite has a pinpoint."},
                tax.ids[3]: {"definition": "", "criteria": "No spelling errors."},
            },
        }
    )
    guidance = {tax.ids[1]: "Formal, objective register.", tax.ids[5]: "Plain language."}
    references = [
        {"key": "refs/02_style.txt", "title": "Style Guide", "content": "Use plain language."},
        {"key": "refs/01_cites.txt", "title": "Citation Guide", "content": "Cite with pinpoints."},
    ]
    footnotes = [
        FootnoteMetadata(footnote_number=1, content="Smith v Jones, 2020 SCC 1 at para 4.",
                         author="", title="Smith v Jones", source="SCC", pinpoint="para 4", year="2020"),
        FootnoteMetadata(footnote_number=2, content="Ibid."),
    ]
    base = {"config": _config([]), "meta": _meta(tax), "segments": make_segments(5)}
    return {
        "plain": {**base},
        "criteria_overrides": {
            **base,
            "config": _config([], density_description=overrides),
            "meta": _meta(tax, guidance),
        },
        "focus_indices": {**base, "focus": {0, 3}},
        "footnotes": {**base, "footnotes": footnotes},
        "references": {**base, "references": references},
        "combined": {
            "config": _config(
                [],
                density_description=overrides,
                structure_description="mcgill",
                restrictions_description="Do not rewrite text.",
                tone_description="Warm but rigorous.",
            ),
            "meta": _meta(tax, guidance),
            "segments": make_segments(7),
            "focus": {1, 2},
            "footnotes": footnotes,
            "references": references,
        },
    }


def _render_variant(variant: dict[str, Any]) -> str:
    with mock.patch.object(prompt_assembly, "_generate_boundary_token", lambda: _FIXED_BOUNDARY):
        structured = handler.build_structured_prompt(
            copy.deepcopy(variant["config"]),
            copy.deepcopy(variant["meta"]),
            "Department guidance for memos.",
            copy.deepcopy(variant["segments"]),
            copy.deepcopy(variant.get("references", [])),
            focus_paragraph_indices=variant.get("focus"),
            footnotes=variant.get("footnotes"),
        )
        return structured.render()


def _write_golden() -> None:
    _GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    renders = {name: _render_variant(v) for name, v in _golden_variants().items()}
    # ensure_ascii keeps the fixture immune to editor/git encoding and EOL changes.
    _GOLDEN_PATH.write_text(json.dumps(renders, indent=2, ensure_ascii=True) + "\n", encoding="ascii")


@pytest.mark.parametrize("variant_name", sorted(_golden_variants()))
def test_no_selection_prompt_render_is_byte_identical_to_golden(variant_name: str) -> None:
    assert _GOLDEN_PATH.exists(), f"golden fixture missing: {_GOLDEN_PATH}"
    golden = json.loads(_GOLDEN_PATH.read_text(encoding="ascii"))
    rendered = _render_variant(_golden_variants()[variant_name])
    assert rendered == golden[variant_name]
    # Sanity: the no-selection taxonomy lists every category and no priority line.
    for cid in _GOLDEN_TAX.ids:
        assert cid in rendered
    assert "Category priority when the density cap binds:" not in rendered


# =========================================================================== #
# 3.14 Budget clamp                                                           #
# =========================================================================== #


@_PBT
@given(
    inline_cap=st.integers(min_value=1, max_value=24),
    category_count=st.integers(min_value=1, max_value=12),
)
def test_budget_clamped_monotonic_and_never_below_original(
    inline_cap: int, category_count: int
) -> None:
    budget = debrief_max_tokens(inline_cap=inline_cap, category_count=category_count)
    original = original_debrief_max_tokens(inline_cap=inline_cap, category_count=category_count)

    assert MIN_DEBRIEF_MAX_TOKENS == 2560 and MAX_DEBRIEF_MAX_TOKENS == 6144
    assert 2560 <= budget <= 6144
    assert budget >= original
    if original == 6144:
        assert budget == 6144
    assert debrief_max_tokens(inline_cap=inline_cap + 1, category_count=category_count) >= budget
    assert debrief_max_tokens(inline_cap=inline_cap, category_count=category_count + 1) >= budget


# =========================================================================== #
# 3.6 / 3.7 Density cap                                                       #
# =========================================================================== #

_KINDS = st.sampled_from(["inline", "inline", "inline", "structural", "strength"])


@st.composite
def raw_item_mixes(draw: st.DrawFn) -> list[dict[str, Any]]:
    cats = draw(st.lists(st.uuids().map(str), min_size=1, max_size=5, unique=True))
    n = draw(st.integers(min_value=0, max_value=30))
    return [
        {
            "error_category_id": draw(st.sampled_from(cats)),
            "kind": draw(_KINDS),
            "question_text": f"Question number {k}?",
        }
        for k in range(n)
    ]


@_PBT
@given(
    items=raw_item_mixes(),
    word_count=st.integers(min_value=0, max_value=6000),
    density=st.sampled_from(["low", "medium", "high", "moderate"]),
)
def test_raw_density_cap_bounds_exemptions_and_frozen_equality(
    items: list[dict[str, Any]], word_count: int, density: str
) -> None:
    cap = compute_density_cap(word_count, density)
    result = apply_raw_inline_density_cap(items, word_count=word_count, density=density)
    frozen = original_raw_inline_density_cap(items, word_count=word_count, density=density)

    inline_in = [i for i in items if i["kind"] == "inline"]
    inline_out = [i for i in result if i["kind"] == "inline"]
    assert [id(i) for i in result] == [id(i) for i in frozen]
    if len(inline_in) <= cap:
        assert [id(i) for i in result] == [id(i) for i in items]
    assert len(inline_out) == min(len(inline_in), cap)
    # Structural and strength items are exempt and keep their order (3.7).
    assert [id(i) for i in result if i["kind"] != "inline"] == [
        id(i) for i in items if i["kind"] != "inline"
    ]
    # Retained inline items keep their relative input order.
    positions = [next(k for k, x in enumerate(items) if x is i) for i in inline_out]
    assert positions == sorted(positions)


@_PBT
@given(
    categories=st.lists(st.sampled_from(["a", "b", "c", "d"]), min_size=0, max_size=30),
    word_count=st.integers(min_value=0, max_value=6000),
    density=st.sampled_from(["low", "medium", "high"]),
)
def test_apply_density_bound_without_keyword_equals_frozen_original(
    categories: list[str], word_count: int, density: str
) -> None:
    wrappers = [
        ValidatedFeedbackItem(category=c, question=f"Question {k}?")
        for k, c in enumerate(categories)
    ]
    outcome = FeedbackClassifier().apply_density_bound(wrappers, word_count, density)
    retained, trimmed, cap = original_apply_density_bound(wrappers, word_count, density)

    assert outcome.cap == cap
    assert [id(i) for i in outcome.retained] == [id(i) for i in retained]
    assert [id(i) for i in outcome.trimmed] == [id(i) for i in trimmed]
    assert len(outcome.retained) == min(len(wrappers), cap)


# =========================================================================== #
# 3.3 / 3.8 / 3.9 Strength coverage                                           #
# =========================================================================== #


@_PBT
@given(tax=taxonomies(), data=st.data())
def test_required_categories_match_frozen_on_non_bug_inputs(
    tax: Taxonomy, data: st.DataObject
) -> None:
    explicit = data.draw(st.booleans())
    if explicit:
        selection = data.draw(
            st.lists(st.sampled_from(tax.ids), min_size=1, max_size=len(tax.ids), unique=True)
        )
    else:
        selection = []
    enabled = expected_enabled(selection, list(tax.ids))
    # Items stay inside E (post-filter) and, with no selection, cover every
    # category (otherwise coverageGap holds on the unfixed engine).
    covered = list(enabled) if not explicit else data.draw(
        st.lists(st.sampled_from(enabled), min_size=0, max_size=len(enabled), unique=True)
    )
    items = [strength(c, f"{k} ") for k, c in enumerate(covered)]
    items += [structural(c, f"s{k}") for k, c in enumerate(enabled)]

    live = required_strength_categories(
        items, valid_category_ids=list(tax.ids), category_priority=selection
    )
    frozen = original_required_strength_categories(
        items, valid_category_ids=list(tax.ids), category_priority=selection
    )
    assert live == frozen == set(enabled)


def _cf_shape(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reshape to the carry-forward ``cf_as_items`` shape (no anchor)."""
    out = []
    for item in items:
        row = {
            "error_category_id": item["error_category_id"],
            "kind": item["kind"],
            "question_text": item["question_text"],
        }
        if item.get("positive_note"):
            row["positive_note"] = item["positive_note"]
        out.append(row)
    return out


@_PBT
@given(tax=taxonomies(), data=st.data(), shape=st.sampled_from(["primary", "carry_forward"]))
def test_no_fill_in_when_every_enabled_category_has_a_strength(
    monkeypatch: pytest.MonkeyPatch, tax: Taxonomy, data: st.DataObject, shape: str
) -> None:
    mode = data.draw(st.sampled_from(["none", "full", "subset"]))
    if mode == "none":
        selection: list[str] = []
    elif mode == "full":
        selection = list(data.draw(st.permutations(tax.ids)))
    else:
        selection = data.draw(
            st.lists(st.sampled_from(tax.ids), min_size=1, max_size=len(tax.ids), unique=True)
        )
    enabled = expected_enabled(selection, list(tax.ids))
    items = [strength(c, f"{k} ") for k, c in enumerate(data.draw(st.permutations(enabled)))]
    extra = data.draw(st.lists(st.sampled_from(enabled), max_size=4))
    items += [inline(c, f"i{k}") for k, c in enumerate(extra)]
    if shape == "carry_forward":
        items = _cf_shape(items)
    before = copy.deepcopy(items)

    calls: list[Any] = []

    def fake_invoke(*args: Any, **kwargs: Any):
        calls.append((args, kwargs))
        return "[]", "end_turn"

    with monkeypatch.context() as mp:
        mp.setattr(handler, "invoke_bedrock", fake_invoke)
        _call_ensure_strength_coverage(items, tax=tax, selection=selection)

    assert calls == [], "strength fill-in invoked although coverage was complete"
    assert items == before, "coverage pass added or changed items"


# =========================================================================== #
# Pipeline: non-bug jobs persist exactly the model items                      #
# =========================================================================== #


def _assert_budget_sane(capture: JobCapture, *, cap: int, tax: Taxonomy) -> None:
    assert len(capture.primary_calls) == 1
    max_tokens = capture.primary_calls[0]["max_tokens"]
    assert 2560 <= max_tokens <= 6144
    assert max_tokens >= original_debrief_max_tokens(inline_cap=cap, category_count=len(tax.ids))


@_PBT_PIPELINE
@given(job=non_bug_jobs(), stop_reason=st.sampled_from(["end_turn", "stop_sequence"]))
def test_non_bug_job_persists_model_items_unchanged(
    monkeypatch: pytest.MonkeyPatch, job: tuple, stop_reason: str
) -> None:
    tax, selection, segments, cap, items = job
    assert not is_bug_condition(
        selection=selection, taxonomy=list(tax.ids), inline_cap=cap, recovered_items=items
    ), bug_condition_clauses(
        selection=selection, taxonomy=list(tax.ids), inline_cap=cap, recovered_items=items
    )

    capture = run_pipeline(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=json.dumps(items),
        stop_reason=stop_reason,
        segments=segments,
    )

    assert capture.persisted == items
    assert capture.calls("strength_fill") == []
    assert capture.calls("quote_fill") == []
    _assert_budget_sane(capture, cap=cap, tax=tax)


@_PBT_PIPELINE
@given(tax=taxonomies(min_size=2), data=st.data())
def test_explicit_selection_filters_to_selected_categories(
    monkeypatch: pytest.MonkeyPatch, tax: Taxonomy, data: st.DataObject
) -> None:
    selection = data.draw(
        st.lists(st.sampled_from(tax.ids), min_size=1, max_size=len(tax.ids) - 1, unique=True)
    )
    segments = make_segments(data.draw(st.sampled_from(_SHORT_PARAGRAPH_COUNTS)))
    cap = compute_density_cap(word_count_from_segments(segments), "medium")
    items = [strength(c, f"{k} ") for k, c in enumerate(tax.ids)]
    items += [structural(c, f"s{k}") for k, c in enumerate(tax.ids)]
    n_inline = data.draw(st.integers(min_value=0, max_value=cap))
    items += [inline(data.draw(st.sampled_from(selection)), f"i{k}") for k in range(n_inline)]

    clauses = bug_condition_clauses(
        selection=selection, taxonomy=list(tax.ids), inline_cap=cap, recovered_items=items
    )
    # promptLeak is intrinsic to any strict subset on the unfixed engine and is
    # about prompt bytes; every item-level clause must be false.
    assert clauses.pop("promptLeak") is True
    assert not any(clauses.values()), clauses

    capture = run_pipeline(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=json.dumps(items),
        stop_reason="end_turn",
        segments=segments,
    )

    expected = [i for i in items if i["error_category_id"] in set(selection)]
    assert capture.persisted == expected
    assert {i["error_category_id"] for i in capture.persisted} == set(selection)
    assert capture.calls("strength_fill") == []


# =========================================================================== #
# 3.11 Truncation semantics                                                   #
# =========================================================================== #

_FIXED_TAX = Taxonomy(ids=_GOLDEN_TAX.ids, names=_GOLDEN_TAX.names)


def test_max_tokens_with_zero_items_is_non_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(TruncatedFeedbackError) as excinfo:
        run_pipeline(
            monkeypatch,
            tax=_FIXED_TAX,
            selection=[],
            model_output='[{"error_category_id": "a1a1a1a1-0000-4000-8000-0000000',
            stop_reason="max_tokens",
            segments=make_segments(2),
        )
    assert isinstance(excinfo.value, NonRetryableFeedbackError)


def test_end_turn_with_zero_items_is_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(Exception) as excinfo:
        run_pipeline(
            monkeypatch,
            tax=_FIXED_TAX,
            selection=[],
            model_output="[]",
            stop_reason="end_turn",
            segments=make_segments(2),
        )
    assert not isinstance(excinfo.value, NonRetryableFeedbackError)
    assert "No feedback items parsed" in str(excinfo.value)


@_PBT_PIPELINE
@given(job=non_bug_jobs())
def test_max_tokens_with_recovered_items_persists_them(
    monkeypatch: pytest.MonkeyPatch, job: tuple
) -> None:
    tax, selection, segments, cap, items = job
    assert not is_bug_condition(
        selection=selection, taxonomy=list(tax.ids), inline_cap=cap, recovered_items=items
    )
    complete = json.dumps(items)
    truncated = complete[:-1] + ', {"error_category_id": "' + tax.ids[0] + '", "kind": "inl'

    capture = run_pipeline(
        monkeypatch,
        tax=tax,
        selection=selection,
        model_output=truncated,
        stop_reason="max_tokens",
        segments=segments,
    )
    assert capture.persisted == items


# =========================================================================== #
# 3.1 / 3.2 / 3.4 / 3.5 Taxonomy validation, remap, guardrail, dedup          #
# =========================================================================== #


@_PBT_PIPELINE
@given(tax=taxonomies(min_size=2), foreign=st.uuids().map(str))
def test_taxonomy_remap_guardrail_and_dedup_unchanged(
    monkeypatch: pytest.MonkeyPatch, tax: Taxonomy, foreign: str
) -> None:
    if foreign in tax.ids:  # pragma: no cover - astronomically unlikely
        return
    strengths = [strength(c, f"{k} ") for k, c in enumerate(tax.ids)]
    structurals = [structural(c, f"s{k}") for k, c in enumerate(tax.ids)]
    # 3.2: first structural item names its category instead of using the UUID.
    by_name = dict(structurals[0], error_category_id=tax.names[0].upper())
    # 3.1: a UUID from another department's taxonomy.
    foreign_item = structural(foreign, "foreign")
    # 3.4: replacement prose in the question.
    ghost = dict(
        inline(tax.ids[1], "ghost"),
        question_text="Here's a revised version of the passage: 'The court held...'",
    )
    # 3.5: duplicate (same category, same question modulo case/whitespace).
    dup = dict(structurals[1], question_text="  " + structurals[1]["question_text"].upper())

    model_items = strengths + [by_name] + structurals[1:] + [foreign_item, ghost, dup]
    expected = strengths + [structurals[0]] + structurals[1:]
    assert not is_bug_condition(
        selection=[], taxonomy=list(tax.ids), inline_cap=1, recovered_items=expected
    )

    capture = run_pipeline(
        monkeypatch,
        tax=tax,
        selection=[],
        model_output=json.dumps(model_items),
        stop_reason="end_turn",
        segments=make_segments(2),
    )
    assert capture.persisted == expected


# =========================================================================== #
# 3.12 Quote safety net                                                       #
# =========================================================================== #


def test_quote_safety_net_still_runs_with_full_taxonomy(monkeypatch: pytest.MonkeyPatch) -> None:
    tax = _FIXED_TAX
    items = [strength(c, f"{k} ") for k, c in enumerate(tax.ids)]
    items += [structural(c, f"s{k}") for k, c in enumerate(tax.ids)]
    capture = run_pipeline(
        monkeypatch,
        tax=tax,
        selection=[],
        model_output=json.dumps(items),
        stop_reason="end_turn",
        segments=make_segments(2),
        quote_coverage=(False, False),
    )
    quote_calls = capture.calls("quote_fill")
    assert len(quote_calls) == 1
    assert quote_calls[0]["max_tokens"] == 1024
    for cid, name in zip(tax.ids, tax.names):
        assert f"  {cid}: {name}" in quote_calls[0]["prompt"]
    assert capture.persisted == items


# =========================================================================== #
# 3.10 Carry-forward snapshot / 3.16 Strength-first order                     #
# =========================================================================== #


def test_config_snapshot_still_hashes_raw_category_priority() -> None:
    tax = _FIXED_TAX
    meta = _meta(tax)
    stale = "ffffffff-0000-4000-8000-00000000dead"
    a = handler._build_config_snapshot(_config(list(tax.ids[:3])), meta, "")
    b = handler._build_config_snapshot(_config(list(tax.ids[:3]) + [stale]), meta, "")
    c = handler._build_config_snapshot(_config(list(tax.ids[:3])), meta, "")
    # A stale ID in the raw selection still changes the hash, so carry-forward
    # validity keeps following the raw saved selection.
    assert a.config_hash == c.config_hash
    assert a.config_hash != b.config_hash


def test_output_schema_keeps_strength_first_order() -> None:
    schema = handler._OUTPUT_SCHEMA
    assert "OUTPUT ORDER (CRITICAL)" in schema
    assert 'Emit every kind="strength" item FIRST' in schema
    assert "strengths must still be present" in schema


if __name__ == "__main__":  # pragma: no cover - fixture capture helper
    if "--write-golden" in sys.argv:
        _write_golden()
        print(f"wrote {_GOLDEN_PATH}")
