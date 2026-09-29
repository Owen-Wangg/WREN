"""Property tests for the debrief output and strength fill-in budgets.

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.3, 3.14**
"""
from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.debrief_budget import (
    MAX_DEBRIEF_MAX_TOKENS,
    MIN_DEBRIEF_MAX_TOKENS,
    debrief_max_tokens,
    strength_fill_max_tokens,
)

OBSERVED_TOKENS_PER_ITEM = 230

_inline_caps = st.integers(min_value=0, max_value=40)
_category_counts = st.integers(min_value=0, max_value=20)


def _original_debrief_max_tokens(*, inline_cap: int, category_count: int) -> int:
    """Frozen pre-fix formula (150 tokens/item)."""
    estimated_items = max(1, inline_cap) + max(category_count, 1) + 2
    return min(6144, max(2560, estimated_items * 150 + 200))


@settings(max_examples=300, deadline=None)
@given(inline_cap=_inline_caps, category_count=_category_counts)
def test_debrief_max_tokens_properties(inline_cap: int, category_count: int) -> None:
    """**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 3.14**"""
    budget = debrief_max_tokens(inline_cap=inline_cap, category_count=category_count)
    requested = max(1, inline_cap) + max(category_count, 1) + 2

    assert MIN_DEBRIEF_MAX_TOKENS <= budget <= MAX_DEBRIEF_MAX_TOKENS
    assert budget >= min(MAX_DEBRIEF_MAX_TOKENS, requested * OBSERVED_TOKENS_PER_ITEM)
    assert budget >= _original_debrief_max_tokens(
        inline_cap=inline_cap, category_count=category_count
    )
    # Monotonic in both arguments.
    assert debrief_max_tokens(inline_cap=inline_cap + 1, category_count=category_count) >= budget
    assert debrief_max_tokens(inline_cap=inline_cap, category_count=category_count + 1) >= budget


@settings(max_examples=200, deadline=None)
@given(missing=st.integers(min_value=0, max_value=40))
def test_strength_fill_max_tokens_properties(missing: int) -> None:
    """**Validates: Requirements 2.3**"""
    budget = strength_fill_max_tokens(missing)
    assert budget >= 2048
    assert budget <= MAX_DEBRIEF_MAX_TOKENS
    assert budget >= min(MAX_DEBRIEF_MAX_TOKENS, missing * OBSERVED_TOKENS_PER_ITEM)
    assert strength_fill_max_tokens(missing + 1) >= budget
