"""Guarantee at least one What's Done Well (kind=strength) item per category.

The model is prompted to emit a strength for every taxonomy category, but it
often omits them — especially when the draft is far from the expected genre.
Step 7c used to only log that gap. This module:

1. Normalizes kind aliases so strength items are not mis-filed.
2. Salvages a strength when the model attached ``positive_note`` to an
   improvement item.
3. Identifies categories that still lack a strength so the handler can run a
   targeted fill-in invocation.
"""
from __future__ import annotations

from typing import Any, Iterable

from .enabled_categories import resolve_enabled_categories

__all__ = [
    "STRENGTH_KIND",
    "normalize_feedback_kinds",
    "salvage_strengths_from_positive_notes",
    "required_strength_categories",
    "missing_strength_categories",
    "categories_with_strengths",
    "categories_without_improvements",
    "accept_filled_strengths",
    "build_strength_fill_prompt",
    "document_text_from_segments",
]

STRENGTH_KIND = "strength"

_KIND_ALIASES: dict[str, str] = {
    "strength": STRENGTH_KIND,
    "strengths": STRENGTH_KIND,
    "done_well": STRENGTH_KIND,
    "donewell": STRENGTH_KIND,
    "whats_done_well": STRENGTH_KIND,
    "affirmation": STRENGTH_KIND,
    "positive": STRENGTH_KIND,
    "inline": "inline",
    "structural": "structural",
    "structure": "structural",
}


def _category_id(item: dict[str, Any]) -> str:
    raw = item.get("error_category_id") or item.get("category") or ""
    return str(raw).strip()


def _positive_note(item: dict[str, Any]) -> str:
    raw = item.get("positive_note") or item.get("positiveNote") or ""
    return raw.strip() if isinstance(raw, str) else ""


def normalize_feedback_kinds(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize ``kind`` in place and return the same list.

    Unknown / missing kinds stay as-is unless a positive_note is present, in
    which case the item is tagged ``strength``. Improvement items that already
    have a recognized kind are not rewritten — those notes are salvaged
    separately so the critique is not dropped.
    """
    for item in items:
        raw_kind = item.get("kind")
        kind_key = raw_kind.strip().lower() if isinstance(raw_kind, str) else ""
        mapped = _KIND_ALIASES.get(kind_key)
        if mapped:
            item["kind"] = mapped
            continue
        if _positive_note(item):
            item["kind"] = STRENGTH_KIND
        elif not kind_key:
            item["kind"] = "inline"
    return items


_IMPROVEMENT_KINDS = frozenset({"inline", "structural"})


def _effective_kind(item: dict[str, Any]) -> str:
    """Kind the item would have after :func:`normalize_feedback_kinds`.

    Read-only mirror of the normalization rules: known aliases map to their
    canonical kind; otherwise a positive_note makes it a strength, a missing
    kind defaults to inline, and an unrecognized kind is left as-is.
    """
    raw_kind = item.get("kind")
    kind_key = raw_kind.strip().lower() if isinstance(raw_kind, str) else ""
    mapped = _KIND_ALIASES.get(kind_key)
    if mapped:
        return mapped
    if _positive_note(item):
        return STRENGTH_KIND
    if not kind_key:
        return "inline"
    return kind_key


def categories_without_improvements(
    items: Iterable[dict[str, Any]],
    enabled_ids: Iterable[str],
) -> list[str]:
    """Enabled category IDs that have no inline or structural item.

    Pure: items are not mutated. Results follow ``enabled_ids`` order (blank
    and duplicate IDs are skipped). Used only for logging improvement gaps —
    callers must never invent items from this.
    """
    covered = {
        _category_id(item)
        for item in items
        if _effective_kind(item) in _IMPROVEMENT_KINDS and _category_id(item)
    }
    gaps: list[str] = []
    seen: set[str] = set()
    for raw in enabled_ids or []:
        if raw is None:
            continue
        cid = str(raw).strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        if cid not in covered:
            gaps.append(cid)
    return gaps


def categories_with_strengths(items: Iterable[dict[str, Any]]) -> set[str]:
    return {
        _category_id(item)
        for item in items
        if item.get("kind") == STRENGTH_KIND and _category_id(item)
    }


def required_strength_categories(
    items: Iterable[dict[str, Any]],
    *,
    valid_category_ids: Iterable[str] | None = None,
    category_priority: Iterable[str] | None = None,
) -> set[str]:
    """Categories that must have a strength item: the enabled set ``E``.

    ``E`` comes from :func:`resolve_enabled_categories` — the saved selection
    intersected with the taxonomy, or the whole taxonomy when the selection is
    empty or fully stale. It does not depend on which categories the model
    happened to emit, and present categories outside ``E`` are not added.

    Only when ``E`` is empty (no taxonomy and no selection) does this fall
    back to the categories present in ``items`` (intersected with
    ``valid_category_ids`` when given).
    """
    enabled = resolve_enabled_categories(category_priority, valid_category_ids)
    required = set(enabled.ids)
    if required:
        return required

    present = {_category_id(item) for item in items if _category_id(item)}
    valid = {str(cid).strip() for cid in (valid_category_ids or []) if str(cid).strip()}
    if valid:
        present &= valid
    return present


def missing_strength_categories(
    items: Iterable[dict[str, Any]],
    required: Iterable[str],
) -> set[str]:
    return {str(cid) for cid in required if cid} - categories_with_strengths(items)


def salvage_strengths_from_positive_notes(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """If an improvement item carries a positive_note, copy it into a strength.

    The original item stays an improvement (its note is cleared) so critique
    is not lost. Categories that already have a strength are left alone.
    """
    covered = categories_with_strengths(items)
    extras: list[dict[str, Any]] = []
    for item in items:
        if item.get("kind") == STRENGTH_KIND:
            continue
        note = _positive_note(item)
        category = _category_id(item)
        if not note or not category or category in covered:
            continue
        strength: dict[str, Any] = {
            "error_category_id": category,
            "kind": STRENGTH_KIND,
            "question_text": (
                item.get("question_text")
                or "How could you build on this strength elsewhere in the draft?"
            ),
            "positive_note": note,
        }
        if isinstance(item.get("anchor"), dict):
            strength["anchor"] = item["anchor"]
        extras.append(strength)
        covered.add(category)
        item["positive_note"] = None
    items.extend(extras)
    return items


def accept_filled_strengths(
    filled: Iterable[dict[str, Any]],
    *,
    missing: Iterable[str],
    valid_category_ids: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Keep one valid strength per missing category from a fill-in response."""
    wanted = {str(cid) for cid in missing if cid}
    valid = {str(cid) for cid in (valid_category_ids or []) if cid}
    accepted: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in filled:
        if item.get("kind") != STRENGTH_KIND:
            continue
        category = _category_id(item)
        if category not in wanted or category in seen:
            continue
        if valid and category not in valid:
            continue
        note = _positive_note(item)
        question = item.get("question_text") or item.get("question") or ""
        if not isinstance(question, str) or not question.strip():
            continue
        if not note:
            continue
        cleaned: dict[str, Any] = {
            "error_category_id": category,
            "kind": STRENGTH_KIND,
            "question_text": question.strip(),
            "positive_note": note,
        }
        if isinstance(item.get("anchor"), dict):
            cleaned["anchor"] = item["anchor"]
        accepted.append(cleaned)
        seen.add(category)
    return accepted


def document_text_from_segments(
    segments: list[dict[str, Any]],
    *,
    max_chars: int | None = None,
    per_paragraph: int | None = None,
) -> str:
    """Join labeled paragraphs, optionally truncated for a cheaper fill-in call."""
    lines: list[str] = []
    used = 0
    for index, segment in enumerate(segments):
        text = segment.get("text", "")
        if not text:
            continue
        if per_paragraph is not None and len(text) > per_paragraph:
            cut = text[:per_paragraph].rsplit(" ", 1)[0]
            text = f"{cut}…" if cut else text[:per_paragraph]
        block = f"[PARAGRAPH {index}]\n{text}"
        if max_chars is not None and used and used + len(block) + 2 > max_chars:
            break
        lines.append(block)
        used += len(block) + 2
    return "\n\n".join(lines)


def build_strength_fill_prompt(
    *,
    document_text: str,
    missing_categories: list[tuple[str, str]],
) -> str:
    """Build a focused prompt that only asks for the missing strength items.

    ``missing_categories`` is a list of ``(category_id, category_name)``.
    """
    taxonomy_lines = "\n".join(
        f"  {cid}: {name}" for cid, name in missing_categories
    )
    return (
        "You are WREN, a Socratic writing coach. Your only task is to name "
        "something the writer already did well.\n\n"
        "Return a JSON array. Each element must have exactly these keys:\n"
        "  error_category_id: string — the exact UUID from the list below\n"
        '  kind: "strength"\n'
        "  question_text: string — one follow-up question that invites the "
        "writer to build on or reflect on the strength\n"
        "  positive_note: string — a specific, exclusively positive affirmation "
        "of something already in the document. No hedging, no criticism, no "
        "rewrites.\n"
        "  anchor: { paragraphIndex: int, quotedText: string } | null — "
        "include a verbatim sentence or clause that demonstrates the strength "
        "when one can be identified\n"
        "Only output valid JSON. No markdown fences, no extra keys.\n\n"
        "COVERAGE: Produce exactly one kind='strength' item for EACH "
        "error_category_id listed below. If you cannot find something "
        "genuinely praiseworthy, affirm the best attempt or effort in that "
        "area. Never invent replacement prose.\n\n"
        "Categories that still need a strength item:\n"
        f"{taxonomy_lines}\n\n"
        "---\n\n"
        "SUBMITTED DOCUMENT\n\n"
        f"{document_text}"
    )
