"""Smoke test for the Python property-test tooling (pytest + Hypothesis, via uv).

This is NOT one of the design's correctness properties (1-30); it is Property 0,
a trivial tooling self-check that verifies the runner, the example floor, the
markers, and the tag convention all work before real property tests are written.

Feature: leon-writing-coach, Property 0: test tooling smoke check
"""
from hypothesis import given
from hypothesis import strategies as st

from leon_testing import (
    FEATURE_SLUG,
    MIN_PROPERTY_EXAMPLES,
    leon_settings,
    property_tag,
)

import pytest


@pytest.mark.property
@leon_settings()
@given(st.integers(), st.integers())
def test_addition_is_commutative(a: int, b: int) -> None:
    # Feature: leon-writing-coach, Property 0: test tooling smoke check
    assert a + b == b + a


@pytest.mark.property
def test_example_floor_is_enforced() -> None:
    seen: list[int] = []

    @leon_settings(max_examples=5)
    @given(st.integers())
    def run(value: int) -> None:
        seen.append(value)

    run()
    assert len(seen) >= MIN_PROPERTY_EXAMPLES


def test_property_tag_format() -> None:
    assert (
        property_tag(16, "Resolution status correctness")
        == "Feature: leon-writing-coach, Property 16: Resolution status correctness"
    )
    assert FEATURE_SLUG == "leon-writing-coach"
