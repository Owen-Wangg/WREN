"""Property-based test for the Diff Engine — Property 8 (selection completeness + identity).

Feature: wren-writing-coach, Property 8: Diff selection completeness and identity

Design (design.md "Property 8: Diff selection completeness and identity"):
  *For any* pair of Drafts, the spans selected for LLM processing include every
  changed or added span and exclude every span lying entirely outside any
  change-plus-context window; when the two Drafts are identical the change set is
  empty and the Feedback Engine is not invoked.

Validates: Requirements 10.1, 10.2, 10.4 (REQ-DRAFT-DIFF-01)
  10.1 — compute the Diff between the prior Draft and the new Draft.
  10.2 — select ONLY the changed/added spans plus a bounded context window, and
         EXCLUDE unchanged spans from the LLM request.
  10.4 — identical Drafts report an empty change set (feedback not invoked).

Strategy
--------
Each example builds a genuine "previous Draft" from a small, collision-prone word
vocabulary, then derives a "current Draft" by applying per-paragraph edits (keep /
delete / edit-in-place / rewrite) interleaved with freshly inserted paragraphs.
The real :class:`DiffEngine` computes the Diff and selects the LLM spans — exactly
the production flow — under an arbitrary non-negative ``context_window``.

Three universal invariants capture Property 8:

* **Completeness** — every changed/added span the Diff reports is fully contained
  in some selected span (nothing that changed is dropped from the LLM request).
* **Exclusion / bounding** — every selected span lives in an ADDED or CHANGED
  current paragraph and lies entirely within the union of change-plus-context
  windows; unchanged/deleted paragraphs contribute nothing, and no selected
  character sits outside a change-plus-context window.
* **Identity** — feeding a Draft against itself yields an empty change set and an
  empty LLM selection (the Feedback Engine is not invoked for unchanged content).
"""
from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wren_engine import ChangeKind, DiffEngine, Segment
from wren_testing import wren_settings

# A deliberately small vocabulary so identical words/paragraphs recur across a
# Draft, which makes every paragraph-level change kind (unchanged / changed /
# added / deleted) — and merged/adjacent intra-paragraph spans — show up often.
_WORDS = ["the", "cat", "dog", "sat", "ran", "fox", "red", "big", "law", "case"]

_words = st.lists(st.sampled_from(_WORDS), min_size=0, max_size=6)


def _paragraph(words: list[str]) -> str:
    return " ".join(words)


@st.composite
def _draft_pair(draw: st.DrawFn) -> tuple[list[str], list[str], int]:
    """Generate ``(prev_texts, curr_texts, context_window)``.

    ``prev_texts`` is the previous Draft; ``curr_texts`` is an arbitrarily edited
    current Draft exercising keep / delete / in-place-edit / rewrite plus inserted
    paragraphs; ``context_window`` is an arbitrary non-negative bound.
    """
    prev_texts = [_paragraph(w) for w in draw(st.lists(_words, min_size=0, max_size=5))]

    curr_texts: list[str] = []
    if draw(st.booleans()):  # sometimes insert a fresh paragraph at the top
        curr_texts.append(_paragraph(draw(_words)))
    for text in prev_texts:
        action = draw(st.sampled_from(["keep", "delete", "edit", "rewrite"]))
        if action == "keep":
            curr_texts.append(text)  # -> UNCHANGED (possibly shifted)
        elif action == "delete":
            pass  # -> DELETED
        elif action == "edit":
            # A small in-place change reliably yields a CHANGED paragraph with
            # intra-paragraph changed spans in current coordinates.
            curr_texts.append(f"{text} {draw(st.sampled_from(_WORDS))}".strip())
        else:  # rewrite -> CHANGED (paired) or ADDED/DELETED at block edges
            curr_texts.append(_paragraph(draw(_words)))
        if draw(st.booleans()):  # sprinkle inserted paragraphs between originals
            curr_texts.append(_paragraph(draw(_words)))

    context_window = draw(st.integers(min_value=0, max_value=20))
    return prev_texts, curr_texts, context_window


def _segments(texts: list[str]) -> list[Segment]:
    return [Segment(index=k, text=t) for k, t in enumerate(texts)]


def _expanded_windows(
    diff, curr_texts: list[str], context_window: int
) -> dict[int, list[tuple[int, int]]]:
    """The change-plus-context windows per current paragraph, from the Diff.

    ADDED paragraph -> the whole current paragraph; CHANGED paragraph -> each
    intra-paragraph changed span expanded by ``context_window`` and clamped to the
    paragraph length. Independent reconstruction of the *allowed* region, used to
    bound what ``select_for_llm`` is permitted to return (Requirement 10.2).
    """
    windows: dict[int, list[tuple[int, int]]] = {}
    for change in diff.changes:
        if change.kind is ChangeKind.ADDED:
            idx = change.curr_index
            assert idx is not None
            windows.setdefault(idx, []).append((0, len(curr_texts[idx])))
        elif change.kind is ChangeKind.CHANGED:
            idx = change.curr_index
            assert idx is not None
            para_len = len(curr_texts[idx])
            bucket = windows.setdefault(idx, [])
            for span in change.changed_spans:
                start = max(0, span.start - context_window)
                end = min(para_len, span.end + context_window)
                bucket.append((start, end))
    return windows


def _within_any(start: int, end: int, ranges: list[tuple[int, int]]) -> bool:
    """True if closed interval ``[start, end]`` fits inside a single range.

    Selected spans are merges of overlapping/adjacent windows, so a contiguous
    merged span is always contained in one merged window; testing single-range
    containment (after merging the reconstructed windows) is the right check.
    """
    for lo, hi in _merge(ranges):
        if lo <= start and end <= hi:
            return True
    return False


def _merge(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge overlapping/adjacent ``[start, end)`` ranges (mirrors the engine)."""
    if not ranges:
        return []
    ordered = sorted(ranges)
    merged = [ordered[0]]
    for lo, hi in ordered[1:]:
        last_lo, last_hi = merged[-1]
        if lo <= last_hi:
            merged[-1] = (last_lo, max(last_hi, hi))
        else:
            merged.append((lo, hi))
    return merged


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_draft_pair())
def test_diff_selection_completeness_and_identity(scenario) -> None:
    # Feature: wren-writing-coach, Property 8: Diff selection completeness and identity
    # Validates: Requirements 10.1, 10.2, 10.4
    prev_texts, curr_texts, context_window = scenario
    engine = DiffEngine()

    # ---- Identity (Requirement 10.4): a Draft against itself is empty. --------
    identity_diff = engine.compute(_segments(prev_texts), _segments(prev_texts))
    assert identity_diff.is_empty is True
    assert engine.select_for_llm(identity_diff, context_window) == []

    # ---- General pair (Requirements 10.1, 10.2). ------------------------------
    diff = engine.compute(_segments(prev_texts), _segments(curr_texts))
    selected = engine.select_for_llm(diff, context_window)

    selected_by_para: dict[int, list[tuple[int, int]]] = {}
    for span in selected:
        # Every selected span is a well-formed range inside a real current paragraph.
        assert 0 <= span.paragraph_index < len(curr_texts)
        para_len = len(curr_texts[span.paragraph_index])
        assert 0 <= span.start <= span.end <= para_len
        selected_by_para.setdefault(span.paragraph_index, []).append(
            (span.start, span.end)
        )

    # Selected spans within a paragraph are ordered and non-overlapping (merged).
    for ranges in selected_by_para.values():
        ordered = sorted(ranges)
        assert ranges == ordered
        for (_, prev_end), (next_start, _) in zip(ordered, ordered[1:]):
            assert next_start > prev_end  # strictly disjoint after merging

    # (a) COMPLETENESS: every changed/added span is covered by a selected span.
    for change in diff.changes:
        if change.kind is ChangeKind.ADDED:
            idx = change.curr_index
            assert idx is not None
            raw = (0, len(curr_texts[idx]))
            assert _within_any(raw[0], raw[1], selected_by_para.get(idx, [])), (
                f"added paragraph {idx} not fully selected"
            )
        elif change.kind is ChangeKind.CHANGED:
            idx = change.curr_index
            assert idx is not None
            for cspan in change.changed_spans:
                assert _within_any(
                    cspan.start, cspan.end, selected_by_para.get(idx, [])
                ), f"changed span {cspan} in paragraph {idx} not selected"

    # (b) EXCLUSION + BOUNDING: selected spans only touch ADDED/CHANGED paragraphs
    # and never stray outside a change-plus-context window (unchanged/deleted
    # paragraphs contribute nothing).
    windows = _expanded_windows(diff, curr_texts, context_window)
    changed_or_added = {
        c.curr_index
        for c in diff.changes
        if c.kind in (ChangeKind.ADDED, ChangeKind.CHANGED)
    }
    for para_index, ranges in selected_by_para.items():
        assert para_index in changed_or_added  # excludes unchanged/deleted paras
        for start, end in ranges:
            assert _within_any(start, end, windows.get(para_index, [])), (
                f"selected span [{start},{end}) in paragraph {para_index} lies "
                "outside every change-plus-context window"
            )

    # (c) IDENTITY corollary: an empty Diff selects nothing (short-circuit).
    if diff.is_empty:
        assert selected == []
