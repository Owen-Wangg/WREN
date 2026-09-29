"""Property tests: improvement-coverage gap detection (log only).

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 3.5, design B.6).

- ``categories_without_improvements(items, E)`` equals the brute-force set
  difference (E minus categories holding an inline/structural item after kind
  normalization), in ``E`` order, and never mutates its input.
- The handler's gap logger emits exactly one ``debrief improvement coverage
  gap`` warning iff that set is non-empty, and never adds items.

**Validates: Requirements 1.4, 2.2, 2.4**
"""
from __future__ import annotations

import copy
import logging
import os
import sys
import uuid
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine.strength_coverage import (  # noqa: E402
    categories_without_improvements,
    normalize_feedback_kinds,
)

_GAP_PREFIX = "debrief improvement coverage gap"

_uuids = st.builds(lambda: str(uuid.uuid4()))

# Canonical, alias, unknown, and missing kinds.
_kinds = st.sampled_from(
    [None, "", "inline", "structural", "strength", "Structure", "STRENGTHS",
     "done_well", "positive", "praise", "unknown_kind"]
)
_notes = st.sampled_from([None, "", "   ", "Well-organized issue statement."])


@st.composite
def _scenarios(draw: st.DrawFn) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    taxonomy = draw(st.lists(_uuids, min_size=1, max_size=8, unique=True))
    enabled = draw(
        st.lists(st.sampled_from(taxonomy), min_size=1, max_size=len(taxonomy), unique=True)
    )
    foreign = draw(st.lists(_uuids, max_size=2, unique=True))
    pool = taxonomy + foreign
    items: list[dict[str, Any]] = []
    for _ in range(draw(st.integers(min_value=0, max_value=15))):
        item: dict[str, Any] = {
            "error_category_id": draw(st.sampled_from(pool)),
            "question_text": "Where else might this pattern appear in your draft?",
        }
        kind = draw(_kinds)
        if kind is not None:
            item["kind"] = kind
        note = draw(_notes)
        if note is not None:
            item["positive_note"] = note
        items.append(item)
    names = [f"Category {k}" for k in range(len(taxonomy))]
    return enabled, list(zip(taxonomy, names)), items  # type: ignore[return-value]


def _brute_force(items: list[dict[str, Any]], enabled: list[str]) -> list[str]:
    normalized = normalize_feedback_kinds(copy.deepcopy(items))
    covered = {
        item["error_category_id"]
        for item in normalized
        if item.get("kind") in {"inline", "structural"}
    }
    return [cid for cid in enabled if cid not in covered]


@settings(max_examples=200, deadline=None)
@given(scenario=_scenarios())
def test_gap_set_matches_brute_force_and_is_pure(scenario) -> None:
    enabled, _pairs, items = scenario
    snapshot = copy.deepcopy(items)

    result = categories_without_improvements(items, enabled)

    assert result == _brute_force(snapshot, enabled)
    assert items == snapshot


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(scenario=_scenarios(), stop_reason=st.sampled_from(["end_turn", "max_tokens", "carry_forward"]))
def test_handler_warns_iff_gap_and_adds_nothing(
    caplog: pytest.LogCaptureFixture, scenario, stop_reason: str
) -> None:
    enabled, pairs, items = scenario
    doc_type_meta = {
        "category_ids": [cid for cid, _ in pairs],
        "category_names": [name for _, name in pairs],
    }
    id_to_name = dict(pairs)
    snapshot = copy.deepcopy(items)
    expected = _brute_force(items, enabled)

    caplog.clear()
    with caplog.at_level(logging.WARNING, logger=handler.logger.name):
        gaps = handler._log_improvement_gap(
            items,
            enabled_category_ids=enabled,
            doc_type_meta=doc_type_meta,
            stop_reason=stop_reason,
        )

    warnings = [
        r.getMessage() for r in caplog.records
        if r.levelno >= logging.WARNING and _GAP_PREFIX in r.getMessage()
    ]
    assert gaps == expected
    assert items == snapshot  # nothing added, nothing mutated
    if expected:
        assert len(warnings) == 1
        message = warnings[0]
        assert stop_reason in message
        for cid in expected:
            assert id_to_name[cid] in message
        # Names only: draft/question text never leaks into the log line.
        assert "Where else might this pattern" not in message
    else:
        assert warnings == []


def test_handler_gap_names_fall_back_to_id(caplog: pytest.LogCaptureFixture) -> None:
    unnamed = str(uuid.uuid4())
    with caplog.at_level(logging.WARNING, logger=handler.logger.name):
        handler._log_improvement_gap(
            [],
            enabled_category_ids=[unnamed],
            doc_type_meta={"category_ids": [], "category_names": []},
            stop_reason="end_turn",
        )
    messages = [r.getMessage() for r in caplog.records if _GAP_PREFIX in r.getMessage()]
    assert len(messages) == 1 and unnamed in messages[0]
