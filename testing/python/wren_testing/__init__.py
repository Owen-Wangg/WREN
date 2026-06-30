"""Shared property-based-testing helper for WREN Writing Coach (Python / Hypothesis).

Enforces the two conventions from the design's Testing Strategy:
  1. Every property test runs a minimum of 100 examples.
  2. Every property test is tagged with a comment referencing its design
     property in the form:
       ``Feature: wren-writing-coach, Property {number}: {property text}``

Each correctness property (1-30) is implemented by a SINGLE property-based test.
Decorate the test with :func:`wren_settings` to guarantee the example floor, and
use :func:`property_tag` (or the literal comment) for traceability.

Hypothesis docs: https://hypothesis.readthedocs.io/
"""
from __future__ import annotations

from hypothesis import settings

#: Minimum number of generated examples every WREN property test must run.
MIN_PROPERTY_EXAMPLES = 100

#: The feature slug used in the property tag convention.
FEATURE_SLUG = "wren-writing-coach"

__all__ = [
    "MIN_PROPERTY_EXAMPLES",
    "FEATURE_SLUG",
    "property_tag",
    "wren_settings",
]


def property_tag(number: int, text: str) -> str:
    """Build the canonical property tag string.

    e.g. ``Feature: wren-writing-coach, Property 16: Resolution status correctness``
    """
    return f"Feature: {FEATURE_SLUG}, Property {number}: {text}"


def wren_settings(**overrides: object) -> settings:
    """Return a Hypothesis ``settings`` profile with the WREN example floor enforced.

    Usable directly as a decorator on a property test::

        @pytest.mark.property
        @wren_settings()
        @given(st.integers())
        def test_property_n(value): ...

    Any ``max_examples`` override is raised to at least
    :data:`MIN_PROPERTY_EXAMPLES`; callers may request more but never fewer.
    """
    requested = overrides.pop("max_examples", MIN_PROPERTY_EXAMPLES)
    max_examples = max(int(requested), MIN_PROPERTY_EXAMPLES)
    return settings(max_examples=max_examples, **overrides)  # type: ignore[arg-type]
