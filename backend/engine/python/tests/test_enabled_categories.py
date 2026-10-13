"""Unit tests for the shared enabled-category resolver (Task 3.1).

Validates: Requirements 2.1, 2.5, 2.10, 3.3
"""
from __future__ import annotations

import dataclasses

import pytest

from wren_engine.enabled_categories import (
    EnabledCategories,
    resolve_enabled_categories,
)

# Illustrative Legal Memorandum taxonomy.
CITATIONS = "11111111-1111-1111-1111-111111111111"
TONE = "22222222-2222-2222-2222-222222222222"
CONSISTENCY = "33333333-3333-3333-3333-333333333333"
SPELLING = "44444444-4444-4444-4444-444444444444"
ORGANIZATION = "55555555-5555-5555-5555-555555555555"
CLARITY = "66666666-6666-6666-6666-666666666666"
T = [CITATIONS, TONE, CONSISTENCY, SPELLING, ORGANIZATION, CLARITY]

STALE_X = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
STALE_Y = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def test_empty_selection_enables_full_taxonomy():
    for empty in ([], None, (), ["", "  ", None]):
        result = resolve_enabled_categories(empty, T)
        assert result.ids == tuple(T)
        assert result.explicit is False
        assert result.stale_ids == ()
        assert result.fell_back is False
        assert result.prompt_priority == ()


def test_subset_selection_is_explicit_filter():
    selection = [TONE, CITATIONS, CLARITY, ORGANIZATION, CONSISTENCY]
    result = resolve_enabled_categories(selection, T)
    assert result.ids == tuple(selection)
    assert result.explicit is True
    assert result.stale_ids == ()
    assert result.fell_back is False
    assert result.prompt_priority == tuple(selection)


def test_partial_stale_selection_drops_stale_ids():
    result = resolve_enabled_categories([STALE_X, TONE, STALE_Y, SPELLING], T)
    assert result.ids == (TONE, SPELLING)
    assert result.explicit is True
    assert result.stale_ids == (STALE_X, STALE_Y)
    assert result.fell_back is False
    assert result.prompt_priority == (TONE, SPELLING)


def test_fully_stale_selection_falls_back_to_taxonomy():
    result = resolve_enabled_categories([STALE_X, STALE_Y], T)
    assert result.ids == tuple(T)
    assert result.explicit is False
    assert result.stale_ids == (STALE_X, STALE_Y)
    assert result.fell_back is True
    assert result.prompt_priority == ()


def test_empty_taxonomy_keeps_selection_legacy():
    result = resolve_enabled_categories([TONE, CITATIONS], [])
    assert result.ids == (TONE, CITATIONS)
    assert result.explicit is True
    assert result.stale_ids == ()
    assert result.fell_back is False

    empty = resolve_enabled_categories([], None)
    assert empty == EnabledCategories(
        ids=(), explicit=False, stale_ids=(), fell_back=False
    )


def test_none_blank_and_non_string_entries_are_normalized():
    result = resolve_enabled_categories(
        [None, "", "   ", f"  {TONE}  ", 42, TONE],
        [TONE, 42, None, " "],
    )
    # 42 is stringified to "42" in both S and T; TONE is stripped and deduped.
    assert result.ids == (TONE, "42")
    assert result.explicit is True
    assert result.stale_ids == ()


def test_order_preservation_and_dedup():
    # Explicit: selection order, deduplicated.
    result = resolve_enabled_categories([CLARITY, TONE, CLARITY, TONE], T)
    assert result.ids == (CLARITY, TONE)
    # Non-explicit: taxonomy order, deduplicated.
    dup_taxonomy = [TONE, CITATIONS, TONE, SPELLING]
    assert resolve_enabled_categories([], dup_taxonomy).ids == (
        TONE,
        CITATIONS,
        SPELLING,
    )


def test_unusual_inputs_never_raise():
    class Unprintable:
        def __str__(self):
            raise RuntimeError("boom")

    assert resolve_enabled_categories(123, T).ids == tuple(T)
    assert resolve_enabled_categories([Unprintable(), TONE], T).ids == (TONE,)
    # A bare string is treated as one ID, not a sequence of characters.
    assert resolve_enabled_categories(TONE, T).ids == (TONE,)
    assert resolve_enabled_categories(None, TONE).ids == (TONE,)


def test_result_is_frozen():
    result = resolve_enabled_categories([TONE], T)
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.ids = ()  # type: ignore[misc]


def test_idempotent_on_ids():
    for selection in ([], [TONE, CLARITY], [STALE_X, TONE], [STALE_X]):
        first = resolve_enabled_categories(selection, T)
        second = resolve_enabled_categories(first.ids, T)
        assert set(second.ids) == set(first.ids)
