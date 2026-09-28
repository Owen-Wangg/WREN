"""Prompt taxonomy lists only enabled categories when a selection is explicit.

Spec: .kiro/specs/debrief-single-category-feedback-fix (Task 3.4, design B.5).

``build_structured_prompt`` resolves the enabled set ``E`` from the saved
selection and the taxonomy. With an explicit selection, the ``## Feedback
taxonomy`` block, the per-category criteria blocks, and the priority line
contain only ``E``. With no selection (or a fully stale one) the original
tuples pass through, so the render is byte-identical to the no-selection case.

**Validates: Requirements 1.5, 2.5, 3.1, 3.15**
"""
from __future__ import annotations

import copy
import json
import os
import sys
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine import prompt_assembly  # noqa: E402

_TAXONOMY_MARKER = "Only these are valid:"
_PRIORITY_PREFIX = "Category priority when the density cap binds: "
_CRITERIA_HEADER = "Per-category evaluation criteria:\n"

IDS = (
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
)
NAMES = ("Citations", "Tone", "Consistency", "Spelling/Grammar", "Organization", "Clarity")
STALE = "99999999-9999-4999-8999-999999999999"
SEGMENTS = [{"text": "The court held that the duty of care applies here."}]


def _config(selection: list[str] | None, *, with_overrides: bool = True) -> dict[str, Any]:
    overrides = {
        cid: {"definition": f"Definition for {name}.", "criteria": f"Criteria for {name}."}
        for cid, name in zip(IDS, NAMES)
    }
    cfg: dict[str, Any] = {
        "density": "medium",
        "tone": "supportive",
        "type_prompt_text": "Review this legal memorandum.",
        "density_description": json.dumps({"v": 1, "overrides": overrides}) if with_overrides else "",
    }
    if selection is not None:
        cfg["category_priority"] = list(selection)
    return cfg


def _meta(ids=IDS, names=NAMES) -> dict[str, Any]:
    return {
        "name": "Legal Memorandum",
        "category_ids": list(ids),
        "category_names": list(names),
        "category_guidance": {},
    }


def _render(monkeypatch: pytest.MonkeyPatch, config, meta) -> str:
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "FIXEDTOKEN")
    return handler.build_structured_prompt(
        copy.deepcopy(config), copy.deepcopy(meta), "", copy.deepcopy(SEGMENTS), []
    ).render()


def taxonomy_lines(rendered: str) -> list[str]:
    if _TAXONOMY_MARKER not in rendered:
        return []
    after = rendered[rendered.index(_TAXONOMY_MARKER) + len(_TAXONOMY_MARKER):]
    lines: list[str] = []
    for line in after.split("\n")[1:]:
        if not line.startswith("  "):
            break
        lines.append(line)
    return lines


def priority_line(rendered: str) -> str | None:
    for line in rendered.split("\n"):
        if line.startswith(_PRIORITY_PREFIX):
            return line[len(_PRIORITY_PREFIX):]
    return None


def criteria_headers(rendered: str) -> list[str]:
    if _CRITERIA_HEADER not in rendered:
        return []
    after = rendered[rendered.index(_CRITERIA_HEADER) + len(_CRITERIA_HEADER):]
    headers: list[str] = []
    for chunk in after.split("\n\n"):
        if not chunk.startswith("["):
            break
        headers.append(chunk.split("\n", 1)[0])
    return headers


def test_deselected_category_absent_from_taxonomy_and_criteria(monkeypatch):
    # Organization (index 4) is switched off; selection order differs from taxonomy order.
    selection = [IDS[3], IDS[0], IDS[5], IDS[1], IDS[2]]
    rendered = _render(monkeypatch, _config(selection), _meta())

    expected_pairs = [(c, n) for c, n in zip(IDS, NAMES) if c != IDS[4]]
    # Taxonomy order is kept in the listing.
    assert taxonomy_lines(rendered) == [f"  {c}: {n}" for c, n in expected_pairs]
    assert criteria_headers(rendered) == [f"[{n}]" for _, n in expected_pairs]
    assert IDS[4] not in rendered
    assert "[Organization]" not in rendered
    assert "Definition for Organization." not in rendered
    # Priority line keeps the admin's selection order.
    assert priority_line(rendered) == ", ".join(selection)


def test_partial_stale_selection_omits_stale_id_from_priority_line(monkeypatch):
    selection = [IDS[0], STALE, IDS[1]]
    rendered = _render(monkeypatch, _config(selection), _meta())

    assert priority_line(rendered) == f"{IDS[0]}, {IDS[1]}"
    assert STALE not in rendered
    assert taxonomy_lines(rendered) == [f"  {IDS[0]}: {NAMES[0]}", f"  {IDS[1]}: {NAMES[1]}"]
    assert criteria_headers(rendered) == [f"[{NAMES[0]}]", f"[{NAMES[1]}]"]


def test_fully_stale_selection_lists_full_taxonomy_without_priority_line(monkeypatch):
    stale_render = _render(monkeypatch, _config([STALE, "not-a-real-id"]), _meta())
    empty_render = _render(monkeypatch, _config([]), _meta())

    assert taxonomy_lines(stale_render) == [f"  {c}: {n}" for c, n in zip(IDS, NAMES)]
    assert priority_line(stale_render) is None
    assert STALE not in stale_render
    # A fully stale selection renders exactly like no selection.
    assert stale_render == empty_render


def test_no_selection_lists_full_taxonomy_and_criteria(monkeypatch):
    for config in (_config([]), _config(None)):
        rendered = _render(monkeypatch, config, _meta())
        assert taxonomy_lines(rendered) == [f"  {c}: {n}" for c, n in zip(IDS, NAMES)]
        assert criteria_headers(rendered) == [f"[{n}]" for n in NAMES]
        assert priority_line(rendered) is None


def test_empty_taxonomy_legacy_path_unchanged(monkeypatch):
    meta = _meta(ids=(), names=("Grammar", "Style"))
    rendered = _render(monkeypatch, _config(["legacy-a", "legacy-b"], with_overrides=False), meta)

    # (The scaffolding mentions "## Feedback taxonomy" in prose; the block itself
    # is identified by its "Only these are valid:" header line.)
    assert _TAXONOMY_MARKER not in rendered
    assert "Error categories (classify only within this set): Grammar, Style" in rendered
    assert priority_line(rendered) == "legacy-a, legacy-b"


def test_stable_and_legacy_configs_both_filtered(monkeypatch):
    """The cached (stable) config carries the same filtered taxonomy as render()."""
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "FIXEDTOKEN")
    selection = [IDS[1], IDS[3]]
    structured = handler.build_structured_prompt(
        _config(selection), _meta(), "", copy.deepcopy(SEGMENTS), []
    )
    stable = structured.document_type
    assert stable.category_ids == (IDS[1], IDS[3])
    assert stable.category_names == (NAMES[1], NAMES[3])
    assert stable.category_priority == (IDS[1], IDS[3])
    assert "[Organization]" not in stable.type_instructions
    assert f"[{NAMES[1]}]" in stable.type_instructions
    assert IDS[4] not in structured.stable_document_type_config
