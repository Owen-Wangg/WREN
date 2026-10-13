"""End-to-end integration tests: debrief single-category feedback fix.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 4).

Drives ``handler.process_feedback_request`` with every DB loader and model
call faked, and captures the rendered prompt, the ``max_tokens`` sent to each
model call, and every batch passed to ``insert_feedback_items``.

Scenarios:
  * Legal Memorandum primary path (5 of 6 selected, inline_cap = 8).
  * Truncated primary response, including zero-item non-retryable failure.
  * No-selection path (golden prompt bytes, strength fill-in budget).
  * Carry-forward fast path (no primary call, targeted fill-in, second run).
  * Explicit selection plus one stale ID (priority line, safety net).

**Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.8, 2.10, 3.3, 3.9, 3.11,
3.12, 3.15**
"""
from __future__ import annotations

import copy
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine import prompt_assembly  # noqa: E402
from wren_engine.carry_forward import (  # noqa: E402
    CachedFeedbackItem,
    CacheKey,
    CarryForwardCache,
    ConfigSnapshot,
)
from wren_engine.debrief_budget import (  # noqa: E402
    debrief_max_tokens,
    strength_fill_max_tokens,
)
from wren_engine.feedback_classifier import (  # noqa: E402
    compute_density_cap,
    word_count_from_segments,
)
from wren_engine.feedback_job_result import (  # noqa: E402
    NonRetryableFeedbackError,
    TruncatedFeedbackError,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem  # noqa: E402


# =========================================================================== #
# Fixtures                                                                    #
# =========================================================================== #

CATEGORY_NAMES: tuple[str, ...] = (
    "Citations",
    "Tone",
    "Consistency",
    "Spelling/Grammar",
    "Organization",
    "Clarity",
)
# Same IDs/names as the golden no-selection fixture (preservation tests).
CATEGORY_IDS: tuple[str, ...] = tuple(
    f"a1a1a1a1-0000-4000-8000-00000000000{n}" for n in range(1, 7)
)
ID = dict(zip(CATEGORY_NAMES, CATEGORY_IDS))
NAME = dict(zip(CATEGORY_IDS, CATEGORY_NAMES))

SG = ID["Spelling/Grammar"]
DESELECTED = ID["Organization"]
STALE = "ffffffff-0000-4000-8000-00000000dead"

# Explicit selection S = T \ {Organization}, in a non-taxonomy order.
SELECTION: list[str] = [
    ID["Spelling/Grammar"],
    ID["Citations"],
    ID["Tone"],
    ID["Clarity"],
    ID["Consistency"],
]
ENABLED: list[str] = list(SELECTION)  # E = S ∩ T, selection order

_SENTENCE = "The court held that the duty of care applies here."  # 10 words
_GOLDEN_PATH = Path(__file__).parent / "fixtures" / "debrief_no_selection_prompts.json"
_FIXED_BOUNDARY = "0123456789abcdef0123456789abcdef"
_GOLDEN_DEPARTMENT_PROMPT = "Department guidance for memos."
_FILL_HEADER = "Categories that still need a strength item:\n"
_QUOTE_HEADER = "Categories:\n"
_PRIORITY_PREFIX = "Category priority when the density cap binds: "
_GAP_PREFIX = "debrief improvement coverage gap"


def make_segments(paragraphs: int) -> list[dict[str, Any]]:
    """``paragraphs`` x 100 words (identical text, like the golden fixture)."""
    return [{"text": " ".join([_SENTENCE] * 10)} for _ in range(paragraphs)]


# 20 x 100 words = 2000 words -> medium density cap 8.
LEGAL_SEGMENTS = make_segments(20)


def _config(selection: list[str]) -> dict[str, Any]:
    return {
        "category_priority": list(selection),
        "density": "medium",
        "tone": "supportive",
        "type_prompt_text": "Review this legal memorandum.",
        "density_description": "",
        "updated_at": None,
    }


def _meta() -> dict[str, Any]:
    return {
        "name": "Legal Memorandum",
        "category_ids": list(CATEGORY_IDS),
        "category_names": list(CATEGORY_NAMES),
        "category_guidance": {},
    }


# --------------------------------------------------------------------------- #
# Item builders                                                               #
# --------------------------------------------------------------------------- #


def strength(cid: str, tag: str = "", paragraph: int = 0) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "strength",
        "question_text": f"How could you apply this strength {tag}elsewhere in the memo?",
        "positive_note": "Your handling of this point is precise and well supported.",
        "anchor": {"paragraphIndex": paragraph, "quotedText": _SENTENCE},
    }


def inline(cid: str, tag: str, paragraph: int = 0) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "inline",
        "question_text": f"Can you find other places where issue {tag} appears in your draft?",
        "positive_note": None,
        "anchor": {"paragraphIndex": paragraph, "quotedText": _SENTENCE},
    }


def structural(cid: str, tag: str) -> dict[str, Any]:
    return {
        "error_category_id": cid,
        "kind": "structural",
        "question_text": f"How does the overall structure support point {tag} of your analysis?",
        "positive_note": None,
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
    primary_calls: list[dict[str, Any]] = field(default_factory=list)
    secondary_calls: list[dict[str, Any]] = field(default_factory=list)
    inserted: list[dict[str, Any]] = field(default_factory=list)
    cf_persisted: list[list[CachedFeedbackItem]] = field(default_factory=list)

    @property
    def persisted(self) -> list[dict[str, Any]]:
        return [item for batch in self.inserted for item in batch["items"]]

    def calls(self, workload: str) -> list[dict[str, Any]]:
        return [c for c in self.secondary_calls if c["workload"] == workload]


def _indented_block(prompt: str, header: str) -> list[tuple[str, str]]:
    """Parse ``  <id>: <name>`` lines that follow ``header``."""
    after = prompt.split(header, 1)[1]
    pairs: list[tuple[str, str]] = []
    for line in after.split("\n"):
        if not line.startswith("  "):
            break
        cid, _, name = line.strip().partition(":")
        pairs.append((cid.strip(), name.strip()))
    return pairs


def _requested_fill_categories(prompt: str) -> list[str]:
    return [cid for cid, _ in _indented_block(prompt, _FILL_HEADER)]


PriorFactory = Callable[[ConfigSnapshot], list[CachedFeedbackItem]]


def run_job(
    monkeypatch: pytest.MonkeyPatch,
    *,
    selection: list[str],
    segments: list[dict[str, Any]],
    model_output: str = "[]",
    stop_reason: str = "end_turn",
    department_prompt: str = "",
    prior_factory: PriorFactory | None = None,
    quote_coverage: tuple[bool, bool] = (True, True),
    quote_fill_output: str = "[]",
    capture: JobCapture | None = None,
) -> JobCapture:
    """Drive ``process_feedback_request`` with DB loaders and model calls faked.

    The fake strength fill-in answers with one valid strength for every
    category listed in its prompt, so coverage assertions exercise the real
    request/accept path. The prompt boundary token is fixed so renders are
    comparable to the golden fixture.
    """
    capture = capture if capture is not None else JobCapture()
    config = _config(selection)
    meta = _meta()

    def fake_cached(structured, cfg, *, max_tokens=None, workload="feedback_primary"):
        capture.primary_calls.append(
            {"prompt": structured.render(), "max_tokens": max_tokens, "workload": workload}
        )
        return model_output, stop_reason

    def fake_invoke(prompt, cfg, *, max_tokens=None, workload="feedback_primary"):
        capture.secondary_calls.append(
            {"prompt": prompt, "max_tokens": max_tokens, "workload": workload}
        )
        if workload == "strength_fill":
            wanted = _requested_fill_categories(prompt)
            return json.dumps([strength(cid, f"fill-{NAME.get(cid, cid)} ") for cid in wanted]), "end_turn"
        if workload == "quote_fill":
            return quote_fill_output, "end_turn"
        return "[]", "end_turn"

    def fake_insert(document_id, draft_id, user_id, items, segs, conn, wipe_existing=True):
        capture.inserted.append(
            {"items": copy.deepcopy(list(items)), "wipe_existing": wipe_existing}
        )
        return len(items)

    def fake_load_prior(document_id, current_draft_id, snapshot, conn):
        if prior_factory is None:
            return [], None
        return prior_factory(snapshot), copy.deepcopy(segments)

    def fake_persist_cf(document_id, new_draft_id, segs, prior_cached, conn):
        capture.cf_persisted.append(list(prior_cached))
        return len(prior_cached)

    with monkeypatch.context() as mp:
        mp.setattr(prompt_assembly, "_generate_boundary_token", lambda: _FIXED_BOUNDARY)
        mp.setattr(handler, "get_db_connection", lambda: _FakeConn())
        mp.setattr(handler, "load_prompt_config", lambda _wt, _c: copy.deepcopy(config))
        mp.setattr(handler, "load_document_type_meta", lambda _wt, _c: copy.deepcopy(meta))
        mp.setattr(handler, "load_department_prompt", lambda _wt, _c: department_prompt)
        mp.setattr(handler, "load_draft_segments", lambda _d, _c: copy.deepcopy(segments))
        mp.setattr(handler, "load_draft_footnotes", lambda _d, _c: [])
        mp.setattr(handler, "load_reference_material", lambda _wt: [])
        mp.setattr(handler, "_load_prior_cached_items", fake_load_prior)
        mp.setattr(handler, "_persist_carried_forward_items", fake_persist_cf)
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


def _warnings(caplog: pytest.LogCaptureFixture, needle: str) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if r.levelno >= logging.WARNING and needle in r.getMessage()
    ]


def _assert_single_gap_warning(
    caplog: pytest.LogCaptureFixture, *, missing: list[str], present: list[str], stop_reason: str
) -> None:
    warnings = _warnings(caplog, _GAP_PREFIX)
    assert len(warnings) == 1, warnings
    message = warnings[0]
    bracket = message[message.index("[") + 1 : message.index("]")]
    named = [n.strip() for n in bracket.split(",") if n.strip()]
    assert sorted(named) == sorted(NAME[c] for c in missing), message
    for cid in present:
        assert NAME[cid] not in named, message
    assert repr(stop_reason) in message, message


def _taxonomy_pairs(rendered: str) -> list[tuple[str, str]]:
    start = rendered.index("## Feedback taxonomy")
    return _indented_block(rendered[start:], "Only these are valid:\n")


def _priority_line(rendered: str) -> str | None:
    for line in rendered.split("\n"):
        if line.startswith(_PRIORITY_PREFIX):
            return line[len(_PRIORITY_PREFIX):]
    return None


def _kinds_by_category(items: list[dict[str, Any]], kind: str) -> list[str]:
    return [i["error_category_id"] for i in items if i.get("kind") == kind]


@pytest.fixture
def info_logs(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO)
    return caplog


# =========================================================================== #
# Legal Memorandum primary path (5 of 6 selected, inline_cap = 8)             #
# =========================================================================== #


def test_legal_memo_primary_path_budget_taxonomy_and_gap_warning(
    monkeypatch: pytest.MonkeyPatch, info_logs: pytest.LogCaptureFixture
) -> None:
    assert compute_density_cap(word_count_from_segments(LEGAL_SEGMENTS), "medium") == 8

    strengths = [strength(cid, f"{k} ") for k, cid in enumerate(ENABLED)]
    improvements = [
        inline(SG, "sg-1", 1),
        inline(SG, "sg-2", 2),
        structural(ID["Citations"], "cit-1"),
    ]
    leaked = inline(DESELECTED, "org-1", 3)  # model ignores the prompt; filter drops it
    capture = run_job(
        monkeypatch,
        selection=SELECTION,
        segments=LEGAL_SEGMENTS,
        model_output=json.dumps(strengths + improvements + [leaked]),
        stop_reason="end_turn",
    )

    # Budget is sized from |E| = 5 at ~300 tokens/item.
    assert len(capture.primary_calls) == 1
    assert capture.primary_calls[0]["max_tokens"] == 4700
    assert capture.primary_calls[0]["max_tokens"] == debrief_max_tokens(
        inline_cap=8, category_count=len(ENABLED)
    )

    # The prompt taxonomy lists only the 5 enabled categories (taxonomy order).
    rendered = capture.primary_calls[0]["prompt"]
    pairs = _taxonomy_pairs(rendered)
    assert pairs == [(cid, NAME[cid]) for cid in CATEGORY_IDS if cid in set(ENABLED)]
    assert DESELECTED not in rendered
    assert _priority_line(rendered) == ", ".join(ENABLED)

    # Improvements persisted unchanged, strengths for all 5, nothing invented.
    assert capture.persisted == strengths + improvements
    assert sorted(_kinds_by_category(capture.persisted, "strength")) == sorted(ENABLED)
    assert capture.calls("strength_fill") == []
    assert capture.calls("quote_fill") == []

    _assert_single_gap_warning(
        info_logs,
        missing=[ID["Tone"], ID["Consistency"], ID["Clarity"]],
        present=[SG, ID["Citations"], DESELECTED],
        stop_reason="end_turn",
    )


# =========================================================================== #
# Truncated primary response                                                  #
# =========================================================================== #


def test_truncated_response_persists_recovered_items_and_logs_gap(
    monkeypatch: pytest.MonkeyPatch, info_logs: pytest.LogCaptureFixture
) -> None:
    strengths = [strength(cid, f"{k} ") for k, cid in enumerate(ENABLED)]
    sg_items = [inline(SG, f"sg-{n}", n) for n in range(3)]
    complete = json.dumps(strengths + sg_items)
    truncated = (
        complete[:-1]
        + ', {"error_category_id": "'
        + ID["Tone"]
        + '", "kind": "inline", "question_text": "Is th'
    )

    capture = run_job(
        monkeypatch,
        selection=SELECTION,
        segments=LEGAL_SEGMENTS,
        model_output=truncated,
        stop_reason="max_tokens",
    )

    assert capture.persisted == strengths + sg_items
    assert capture.calls("strength_fill") == []
    assert _warnings(info_logs, "Bedrock stopped at max_tokens")
    _assert_single_gap_warning(
        info_logs,
        missing=[ID["Citations"], ID["Tone"], ID["Consistency"], ID["Clarity"]],
        present=[SG, DESELECTED],
        stop_reason="max_tokens",
    )


def test_truncated_response_with_zero_items_is_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture = JobCapture()
    with pytest.raises(TruncatedFeedbackError) as excinfo:
        run_job(
            monkeypatch,
            selection=SELECTION,
            segments=LEGAL_SEGMENTS,
            model_output='[{"error_category_id": "' + SG[:12],
            stop_reason="max_tokens",
            capture=capture,
        )
    assert isinstance(excinfo.value, NonRetryableFeedbackError)
    assert len(capture.primary_calls) == 1
    assert capture.inserted == []
    assert capture.secondary_calls == []


# =========================================================================== #
# No-selection path                                                           #
# =========================================================================== #


def test_no_selection_path_golden_prompt_and_strength_fill_budget(
    monkeypatch: pytest.MonkeyPatch, info_logs: pytest.LogCaptureFixture
) -> None:
    segments = make_segments(5)  # matches the golden "plain" variant
    cap = compute_density_cap(word_count_from_segments(segments), "medium")
    sg_only = [strength(SG, "sg "), inline(SG, "sg-1", 1)]

    capture = run_job(
        monkeypatch,
        selection=[],
        segments=segments,
        model_output=json.dumps(sg_only),
        stop_reason="end_turn",
        department_prompt=_GOLDEN_DEPARTMENT_PROMPT,
    )

    golden = json.loads(_GOLDEN_PATH.read_text(encoding="ascii"))
    assert len(capture.primary_calls) == 1
    assert capture.primary_calls[0]["prompt"] == golden["plain"]
    assert capture.primary_calls[0]["max_tokens"] == debrief_max_tokens(
        inline_cap=cap, category_count=len(CATEGORY_IDS)
    )

    fill_calls = capture.calls("strength_fill")
    assert len(fill_calls) == 1
    assert fill_calls[0]["max_tokens"] == strength_fill_max_tokens(5)
    others = [cid for cid in CATEGORY_IDS if cid != SG]
    assert sorted(_requested_fill_categories(fill_calls[0]["prompt"])) == sorted(others)

    persisted = capture.persisted
    assert sorted(_kinds_by_category(persisted, "strength")) == sorted(CATEGORY_IDS)
    # Model items persisted first, unchanged; only strengths were added.
    assert persisted[: len(sg_only)] == sg_only
    assert all(i["kind"] == "strength" for i in persisted[len(sg_only):])
    assert _warnings(info_logs, "strength coverage incomplete") == []


# =========================================================================== #
# Carry-forward fast path                                                     #
# =========================================================================== #

# Distinct paragraph texts so fingerprints map to a single index each.
CF_SEGMENTS: list[dict[str, Any]] = [
    {"text": f"Paragraph {i} explains why the duty of care applies to scenario {i}."}
    for i in range(4)
]
_GENERATED_AT = datetime(2024, 1, 1, tzinfo=timezone.utc)


def _para_fp(paragraph: int) -> str:
    text = CF_SEGMENTS[paragraph]["text"]
    return handler.compute_anchor_fingerprint(text, 0, len(text)).text_hash


def _doc_hash() -> str:
    return CarryForwardCache.compute_document_hash(
        "\n".join(seg["text"] for seg in CF_SEGMENTS)
    )


def cf_inline(cid: str, paragraph: int, snap: ConfigSnapshot) -> CachedFeedbackItem:
    return CachedFeedbackItem(
        item=ValidatedFeedbackItem(
            category=cid,
            question=f"Can you find other places where issue p{paragraph} appears?",
            anchor={"paragraph": paragraph, "start": 0, "end": 9},
        ),
        cache_key=CacheKey(
            span_fingerprint=_para_fp(paragraph),
            config_hash=snap.config_hash,
            is_structural=False,
        ),
        generated_at=_GENERATED_AT,
        config_snapshot=snap,
        kind="inline",
    )


def cf_strength(
    cid: str,
    snap: ConfigSnapshot,
    *,
    paragraph: int | None,
    question: str = "How could you keep this precision throughout?",
    note: str = "Your spelling is consistently careful.",
) -> CachedFeedbackItem:
    anchored = paragraph is not None
    return CachedFeedbackItem(
        item=ValidatedFeedbackItem(
            category=cid,
            question=question,
            anchor={"paragraph": paragraph, "start": 0, "end": 9} if anchored else None,
            positive_note=note,
        ),
        cache_key=CacheKey(
            span_fingerprint=_para_fp(paragraph) if anchored else _doc_hash(),
            config_hash=snap.config_hash,
            is_structural=not anchored,
        ),
        generated_at=_GENERATED_AT,
        config_snapshot=snap,
        kind="strength",
    )


def _sg_only_prior(snap: ConfigSnapshot) -> list[CachedFeedbackItem]:
    return [cf_strength(SG, snap, paragraph=0)] + [
        cf_inline(SG, p, snap) for p in range(len(CF_SEGMENTS))
    ]


def test_carry_forward_fast_path_fills_only_uncovered_enabled_categories(
    monkeypatch: pytest.MonkeyPatch, info_logs: pytest.LogCaptureFixture
) -> None:
    capture = run_job(
        monkeypatch,
        selection=SELECTION,
        segments=CF_SEGMENTS,
        prior_factory=_sg_only_prior,
    )

    # Fast path taken: prior items reused, no primary model call.
    assert capture.primary_calls == []
    assert len(capture.cf_persisted) == 1
    assert len(capture.cf_persisted[0]) == 1 + len(CF_SEGMENTS)

    uncovered = [cid for cid in ENABLED if cid != SG]
    fill_calls = capture.calls("strength_fill")
    assert len(fill_calls) == 1
    assert sorted(_requested_fill_categories(fill_calls[0]["prompt"])) == sorted(uncovered)
    assert fill_calls[0]["max_tokens"] == strength_fill_max_tokens(len(uncovered))

    assert len(capture.inserted) == 1
    assert capture.inserted[0]["wipe_existing"] is False
    new_items = capture.inserted[0]["items"]
    assert all(i["kind"] == "strength" for i in new_items)
    assert sorted(i["error_category_id"] for i in new_items) == sorted(uncovered)
    assert DESELECTED not in {i["error_category_id"] for i in new_items}

    _assert_single_gap_warning(
        info_logs, missing=uncovered, present=[SG, DESELECTED], stop_reason="carry_forward"
    )

    # Second run: prior items now cover every enabled category with a strength.
    filled = [(i["error_category_id"], i["question_text"], i["positive_note"]) for i in new_items]

    def full_prior(snap: ConfigSnapshot) -> list[CachedFeedbackItem]:
        return _sg_only_prior(snap) + [
            cf_strength(cid, snap, paragraph=None, question=q, note=n)
            for cid, q, n in filled
        ]

    second = run_job(
        monkeypatch,
        selection=SELECTION,
        segments=CF_SEGMENTS,
        prior_factory=full_prior,
    )
    assert second.primary_calls == []
    assert len(second.cf_persisted) == 1
    assert len(second.cf_persisted[0]) == 1 + len(CF_SEGMENTS) + len(uncovered)
    assert second.calls("strength_fill") == []
    assert second.inserted == []


# =========================================================================== #
# Explicit selection plus one stale ID                                        #
# =========================================================================== #


def test_explicit_selection_with_stale_id_limits_prompt_items_and_safety_net(
    monkeypatch: pytest.MonkeyPatch, info_logs: pytest.LogCaptureFixture
) -> None:
    selection = SELECTION + [STALE]
    all_strengths = [strength(cid, f"{k} ") for k, cid in enumerate(CATEGORY_IDS)]
    improvements = [inline(SG, "sg-1", 1), structural(ID["Tone"], "tone-1")]
    foreign = structural(STALE, "stale-1")
    leaked = inline(DESELECTED, "org-1", 2)
    quote_fill = [strength(ID["Clarity"], "quote-fill ", 4)]

    capture = run_job(
        monkeypatch,
        selection=selection,
        segments=LEGAL_SEGMENTS,
        model_output=json.dumps(all_strengths + improvements + [foreign, leaked]),
        stop_reason="end_turn",
        quote_coverage=(False, True),
        quote_fill_output=json.dumps(quote_fill),
    )

    # Stale ID ignored: |E| = 5, priority line lists only the valid IDs.
    assert capture.primary_calls[0]["max_tokens"] == debrief_max_tokens(
        inline_cap=8, category_count=len(ENABLED)
    )
    rendered = capture.primary_calls[0]["prompt"]
    assert _priority_line(rendered) == ", ".join(ENABLED)
    assert STALE not in rendered
    assert {cid for cid, _ in _taxonomy_pairs(rendered)} == set(ENABLED)

    stale_warnings = _warnings(info_logs, "not in this document type's taxonomy")
    assert len(stale_warnings) == 1
    assert "1 ID(s)" in stale_warnings[0]
    assert STALE not in stale_warnings[0]

    # Primary batch: foreign, deselected, and Organization's strength dropped.
    expected_primary = [s for s in all_strengths if s["error_category_id"] != DESELECTED]
    expected_primary += improvements
    assert capture.inserted[0]["items"] == expected_primary
    assert capture.calls("strength_fill") == []

    # Quote safety net offered only enabled categories.
    quote_calls = capture.calls("quote_fill")
    assert len(quote_calls) == 1
    offered = _indented_block(quote_calls[0]["prompt"], _QUOTE_HEADER)
    assert offered == [(cid, NAME[cid]) for cid in ENABLED]

    assert len(capture.inserted) == 2
    assert capture.inserted[1]["wipe_existing"] is False
    assert {i["error_category_id"] for i in capture.persisted} <= set(ENABLED)
