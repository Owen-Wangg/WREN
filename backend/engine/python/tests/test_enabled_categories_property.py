"""Property tests for the shared enabled-category resolver (Task 3.1).

For any selection ``S`` and taxonomy ``T``:
* ``E ⊆ T`` and ``E ≠ ∅`` whenever ``T ≠ ∅``;
* ``explicit ⇔ S ∩ T ≠ ∅`` (for ``T ≠ ∅``);
* ``stale_ids = S \\ T`` in selection order;
* resolving ``E`` again yields the same set (idempotence);
* the resolver never raises.

**Validates: Requirements 2.1, 2.5, 2.10, 3.3**
"""
from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.enabled_categories import resolve_enabled_categories

# A small ID pool so selections and taxonomies overlap often.
_POOL = [f"cat-{i:02d}" for i in range(16)]

_ids = st.lists(st.sampled_from(_POOL), max_size=12)

# Messy entries: None, blanks, padded strings, and non-string values.
_messy_entry = st.one_of(
    st.none(),
    st.sampled_from(["", " ", "\t"]),
    st.sampled_from(_POOL),
    st.sampled_from(_POOL).map(lambda s: f"  {s} "),
    st.integers(min_value=0, max_value=5),
)
_messy_ids = st.one_of(st.none(), st.lists(_messy_entry, max_size=12))


def _norm(values):
    """Reference normalization: strip/stringify/ordered-dedup, skip blanks."""
    out: list[str] = []
    for v in values or []:
        if v is None:
            continue
        s = str(v).strip()
        if s and s not in out:
            out.append(s)
    return out


@settings(max_examples=300)
@given(selection=_ids, taxonomy=_ids.filter(bool))
def test_enabled_is_nonempty_subset_of_taxonomy(selection, taxonomy):
    result = resolve_enabled_categories(selection, taxonomy)
    assert result.ids
    assert set(result.ids) <= set(taxonomy)


@settings(max_examples=300)
@given(selection=_ids, taxonomy=_ids.filter(bool))
def test_explicit_iff_selection_intersects_taxonomy(selection, taxonomy):
    result = resolve_enabled_categories(selection, taxonomy)
    intersects = bool(set(selection) & set(taxonomy))
    assert result.explicit == intersects
    assert result.fell_back == (bool(selection) and not intersects)
    if result.explicit:
        # Selection order, only taxonomy members.
        assert list(result.ids) == [c for c in _norm(selection) if c in taxonomy]
        assert result.prompt_priority == result.ids
    else:
        assert list(result.ids) == _norm(taxonomy)
        assert result.prompt_priority == ()


@settings(max_examples=300)
@given(selection=_ids, taxonomy=_ids.filter(bool))
def test_stale_ids_are_selection_minus_taxonomy(selection, taxonomy):
    result = resolve_enabled_categories(selection, taxonomy)
    taxonomy_set = set(taxonomy)
    assert list(result.stale_ids) == [
        c for c in _norm(selection) if c not in taxonomy_set
    ]


@settings(max_examples=300)
@given(selection=_messy_ids, taxonomy=_messy_ids)
def test_idempotent_on_ids(selection, taxonomy):
    first = resolve_enabled_categories(selection, taxonomy)
    second = resolve_enabled_categories(first.ids, taxonomy)
    assert set(second.ids) == set(first.ids)


@settings(max_examples=300)
@given(selection=_messy_ids, taxonomy=_messy_ids)
def test_never_raises_and_matches_normalized_inputs(selection, taxonomy):
    result = resolve_enabled_categories(selection, taxonomy)
    norm_s = _norm(selection)
    norm_t = _norm(taxonomy)
    assert all(isinstance(c, str) and c and c == c.strip() for c in result.ids)
    assert len(result.ids) == len(set(result.ids))
    if norm_t:
        assert result.ids
        assert set(result.ids) <= set(norm_t)
    else:
        # Legacy: selection passes through unchanged.
        assert list(result.ids) == norm_s
