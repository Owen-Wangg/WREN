import pytest

from wren_engine.debrief_budget import (
    DEBRIEF_TOKENS_PER_ITEM,
    cap_reference_materials,
    debrief_max_tokens,
    strength_fill_max_tokens,
)


def test_cap_reference_materials_enforces_per_file_and_total() -> None:
    materials = [
        {"title": "a", "content": "x" * 8000},
        {"title": "b", "content": "y" * 8000},
        {"title": "c", "content": "z" * 8000},
        {"title": "d", "content": "w" * 8000},
    ]
    capped = cap_reference_materials(materials)
    assert all(len(m["content"]) <= 4000 for m in capped)
    assert sum(len(m["content"]) for m in capped) <= 12_000
    assert len(capped) < len(materials)


def test_debrief_max_tokens_stays_in_budget() -> None:
    assert debrief_max_tokens(inline_cap=4, category_count=3) >= 2560
    assert debrief_max_tokens(inline_cap=40, category_count=12) <= 6144
    assert debrief_max_tokens(inline_cap=8, category_count=4) < debrief_max_tokens(
        inline_cap=24, category_count=8
    )


def test_debrief_tokens_per_item_constant() -> None:
    assert DEBRIEF_TOKENS_PER_ITEM == 300


@pytest.mark.parametrize(
    ("inline_cap", "category_count", "old_budget", "new_budget"),
    [
        (8, 6, 2600, 5000),
        (12, 6, 3200, 6144),
        (8, 5, 2560, 4700),
    ],
)
def test_debrief_max_tokens_legal_memorandum_regression(
    inline_cap: int, category_count: int, old_budget: int, new_budget: int
) -> None:
    """Legal Memorandum budgets truncated at 150 tokens/item; 300/item fits them."""
    budget = debrief_max_tokens(inline_cap=inline_cap, category_count=category_count)
    assert budget == new_budget
    assert budget >= 1.4 * old_budget
    assert budget <= 6144


@pytest.mark.parametrize(
    ("missing_count", "expected"),
    [(1, 2048), (6, 2048), (7, 2300), (12, 3800), (30, 6144)],
)
def test_strength_fill_max_tokens(missing_count: int, expected: int) -> None:
    assert strength_fill_max_tokens(missing_count) == expected
