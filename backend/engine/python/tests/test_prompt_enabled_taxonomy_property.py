"""Property tests: the prompt taxonomy block lists exactly the enabled set.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 3.4, design B.5).

For arbitrary taxonomies ``T`` (1-12 UUIDs with names) and selections ``S``
(subsets of ``T`` plus stale UUIDs):

* the taxonomy-block UUID set equals ``E`` when the selection is explicit and
  ``T`` otherwise;
* no ``T \\ E`` UUID appears anywhere in the rendered prompt;
* with ``S = []`` the document-type config equals a frozen legacy
  ``DocumentTypePromptConfig`` built from the full tuples.

**Validates: Requirements 1.5, 2.5, 3.1, 3.15**
"""
from __future__ import annotations

import copy
import dataclasses
import json
import os
import sys
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine import prompt_assembly  # noqa: E402
from wren_engine.prompt_assembly import DocumentTypePromptConfig  # noqa: E402

from test_prompt_enabled_taxonomy import (  # noqa: E402
    SEGMENTS,
    criteria_headers,
    priority_line,
    taxonomy_lines,
)

_SETTINGS = settings(max_examples=60, deadline=None)


@st.composite
def taxonomy_and_selection(draw):
    uuids = draw(st.lists(st.uuids(), min_size=1, max_size=18, unique=True))
    size = draw(st.integers(min_value=1, max_value=min(12, len(uuids))))
    ids = [str(u) for u in uuids[:size]]
    stale_pool = [str(u) for u in uuids[size:]]
    names = [f"Category {i} {ids[i][:4]}" for i in range(size)]
    picked = draw(st.lists(st.sampled_from(ids), unique=True, max_size=size))
    stale = draw(st.lists(st.sampled_from(stale_pool), unique=True)) if stale_pool else []
    selection = draw(st.permutations(picked + stale))
    return ids, names, list(selection)


def _config(selection: list[str], ids: list[str], names: list[str]) -> dict[str, Any]:
    overrides = {
        cid: {"definition": f"Definition for {name}.", "criteria": f"Criteria for {name}."}
        for cid, name in zip(ids, names)
    }
    return {
        "category_priority": list(selection),
        "density": "medium",
        "tone": "supportive",
        "type_prompt_text": "Review this legal memorandum.",
        "density_description": json.dumps({"v": 1, "overrides": overrides}),
    }


def _meta(ids: list[str], names: list[str]) -> dict[str, Any]:
    return {
        "name": "Legal Memorandum",
        "category_ids": list(ids),
        "category_names": list(names),
        "category_guidance": {},
    }


def _expected_enabled(selection: list[str], ids: list[str]) -> tuple[list[str], bool]:
    """Reference for E: S ∩ T in selection order, else T. Returns (E, explicit)."""
    kept = [c for c in selection if c in set(ids)]
    return (kept, True) if kept else (list(ids), False)


def _build(ids, names, selection):
    original = prompt_assembly._generate_boundary_token
    prompt_assembly._generate_boundary_token = lambda: "FIXEDTOKEN"
    try:
        return handler.build_structured_prompt(
            _config(selection, ids, names), _meta(ids, names), "", copy.deepcopy(SEGMENTS), []
        )
    finally:
        prompt_assembly._generate_boundary_token = original


@_SETTINGS
@given(data=taxonomy_and_selection())
def test_taxonomy_block_equals_enabled_set(data) -> None:
    ids, names, selection = data
    enabled, explicit = _expected_enabled(selection, ids)
    rendered = _build(ids, names, selection).render()

    listed = [line.strip().split(":", 1)[0] for line in taxonomy_lines(rendered)]
    # Taxonomy order is kept; the set equals E when explicit and T otherwise.
    expected_listed = [c for c in ids if c in set(enabled)] if explicit else list(ids)
    assert listed == expected_listed

    name_of = dict(zip(ids, names))
    assert criteria_headers(rendered) == [f"[{name_of[c]}]" for c in expected_listed]

    if explicit:
        assert priority_line(rendered) == ", ".join(enabled)
    else:
        assert priority_line(rendered) is None

    disabled = set(ids) - set(expected_listed)
    stale = set(selection) - set(ids)
    for cid in disabled | stale:
        assert cid not in rendered
    for cid in disabled:
        assert f"[{name_of[cid]}]" not in rendered


@_SETTINGS
@given(data=taxonomy_and_selection())
def test_no_selection_config_matches_frozen_legacy(data) -> None:
    ids, names, _selection = data
    structured = _build(ids, names, [])
    stable = structured.document_type

    frozen = DocumentTypePromptConfig(
        document_type_name="Legal Memorandum",
        category_names=tuple(names),
        category_ids=tuple(ids),
        tone="supportive",
        density="medium",
        category_priority=tuple([]),
        type_instructions=stable.type_instructions,
        reference_grounding_note="",
    )
    assert stable == frozen
    assert dataclasses.asdict(stable) == dataclasses.asdict(frozen)

    rendered = structured.render()
    assert taxonomy_lines(rendered) == [f"  {c}: {n}" for c, n in zip(ids, names)]
    assert criteria_headers(rendered) == [f"[{n}]" for n in names]
    assert priority_line(rendered) is None
