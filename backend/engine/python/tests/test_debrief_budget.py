from wren_engine.debrief_budget import cap_reference_materials, debrief_max_tokens


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
