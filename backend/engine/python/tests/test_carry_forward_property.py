"""Property test: Carry-forward caching (Task 9.11 / Property 9).

For any prior cached feedback item and any current draft/config state, the
CarryForwardCache carries the item forward if and only if both its span
text (or, for structural items, the full document) and its governing
config are unchanged. Any text change or any config change invalidates the
item; carried-forward + invalidated always partitions the input exactly
(no item is lost, duplicated, or double-counted), and every current span
not covered by a carried-forward item is reported as new.

Validates: Requirements 10.3, 49.1, 49.2, 27.3

Feature: wren-writing-coach, Property 9
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.carry_forward import (
    CacheKey,
    CachedFeedbackItem,
    CarryForwardCache,
    ConfigSnapshot,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem
from wren_engine.structural_feedback import StructuralFeedbackItem


# ─── Strategies ────────────────────────────────────────────────────────────────

_EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)

_fingerprints = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Nd")), min_size=1, max_size=12
)

_category_tuples = st.lists(
    st.sampled_from(["Grammar", "Clarity", "Structure", "Citation", "Tone"]),
    min_size=1,
    max_size=5,
    unique=True,
).map(tuple)

_tones = st.sampled_from(["formal", "casual", "academic"])
_densities = st.sampled_from(["low", "medium", "high"])

_span_indices = st.integers(min_value=0, max_value=20)


def _config(categories: tuple[str, ...], tone: str, density: str) -> ConfigSnapshot:
    return ConfigSnapshot.from_config(
        category_names=categories,
        tone=tone,
        density=density,
        updated_at=_EPOCH,
    )


def _cached_inline(config: ConfigSnapshot, span_fp: str, para: int) -> CachedFeedbackItem:
    return CachedFeedbackItem(
        item=ValidatedFeedbackItem(
            category="Grammar",
            question="Is this correct?",
            anchor={"start": para * 100, "end": para * 100 + 50, "paragraph": para},
            citation=None,
        ),
        cache_key=CacheKey(span_fingerprint=span_fp, config_hash=config.config_hash),
        generated_at=_EPOCH,
        config_snapshot=config,
    )


def _cached_structural(config: ConfigSnapshot, doc_hash: str) -> CachedFeedbackItem:
    return CachedFeedbackItem(
        item=StructuralFeedbackItem(category="Organization", question="How is this organized?"),
        cache_key=CacheKey(span_fingerprint=doc_hash, config_hash=config.config_hash, is_structural=True),
        generated_at=_EPOCH,
        config_snapshot=config,
    )


@pytest.mark.property
class TestCarryForwardCachingProperty:
    """Property 9: Carry-forward caching (REQ-DRAFT-DIFF-01 criterion 3, REQ-NFR-COST-01)."""

    # Feature: wren-writing-coach, Property 9: Carry-forward caching

    @settings(max_examples=200)
    @given(
        span_fp=_fingerprints,
        para=_span_indices,
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_carried_forward_when_span_and_config_unchanged(
        self, span_fp: str, para: int, categories: tuple[str, ...], tone: str, density: str
    ) -> None:
        """Unchanged text + unchanged config -> always carried forward, never invalidated."""
        config = _config(categories, tone, density)
        cached = _cached_inline(config, span_fp, para)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={para: span_fp},
            current_config=config,
        )

        assert len(result.carried_forward) == 1
        assert len(result.invalidated) == 0

    @settings(max_examples=200)
    @given(
        span_fp=_fingerprints,
        new_fp=_fingerprints,
        para=_span_indices,
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_invalidated_when_span_text_changes(
        self,
        span_fp: str,
        new_fp: str,
        para: int,
        categories: tuple[str, ...],
        tone: str,
        density: str,
    ) -> None:
        """Any fingerprint change on the anchored span invalidates the cached item."""
        assume_changed = span_fp != new_fp
        if not assume_changed:
            return  # nothing to test when fingerprints coincide
        config = _config(categories, tone, density)
        cached = _cached_inline(config, span_fp, para)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={para: new_fp},
            current_config=config,
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    @settings(max_examples=200)
    @given(
        span_fp=_fingerprints,
        para=_span_indices,
        categories_a=_category_tuples,
        categories_b=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_invalidated_when_config_changes(
        self,
        span_fp: str,
        para: int,
        categories_a: tuple[str, ...],
        categories_b: tuple[str, ...],
        tone: str,
        density: str,
    ) -> None:
        """Any governing-config change invalidates the item, even with unchanged text."""
        old_config = _config(categories_a, tone, density)
        new_config = _config(categories_b, tone, density)
        if old_config.config_hash == new_config.config_hash:
            return  # coincidental hash collision on identical inputs; nothing to test
        cached = _cached_inline(old_config, span_fp, para)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={para: span_fp},
            current_config=new_config,
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    @settings(max_examples=150)
    @given(
        doc_hash=_fingerprints,
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_structural_carried_forward_when_document_unchanged(
        self, doc_hash: str, categories: tuple[str, ...], tone: str, density: str
    ) -> None:
        """Structural items carry forward only when the WHOLE document hash is unchanged."""
        config = _config(categories, tone, density)
        cached = _cached_structural(config, doc_hash)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={},
            current_config=config,
            current_doc_hash=doc_hash,
        )

        assert len(result.carried_forward) == 1
        assert len(result.invalidated) == 0

    @settings(max_examples=150)
    @given(
        doc_hash=_fingerprints,
        new_doc_hash=_fingerprints,
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_structural_invalidated_on_any_document_change(
        self,
        doc_hash: str,
        new_doc_hash: str,
        categories: tuple[str, ...],
        tone: str,
        density: str,
    ) -> None:
        """A change anywhere in the document invalidates structural (whole-doc) items."""
        if doc_hash == new_doc_hash:
            return
        config = _config(categories, tone, density)
        cached = _cached_structural(config, doc_hash)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={},
            current_config=config,
            current_doc_hash=new_doc_hash,
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    @settings(max_examples=150)
    @given(
        fingerprint_map=st.dictionaries(
            keys=_span_indices, values=_fingerprints, min_size=0, max_size=8
        ),
        prior_spans=st.dictionaries(
            keys=_span_indices, values=_fingerprints, min_size=0, max_size=8
        ),
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_carried_forward_and_invalidated_partition_prior_items(
        self,
        fingerprint_map: dict[int, str],
        prior_spans: dict[int, str],
        categories: tuple[str, ...],
        tone: str,
        density: str,
    ) -> None:
        """carried_forward ∪ invalidated always equals the full prior-items input,
        with no overlap and no loss, regardless of the current draft/config state."""
        config = _config(categories, tone, density)
        prior_items = [
            _cached_inline(config, fp, para) for para, fp in prior_spans.items()
        ]
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=prior_items,
            current_span_fingerprints=fingerprint_map,
            current_config=config,
        )

        assert len(result.carried_forward) + len(result.invalidated) == len(prior_items)
        # No item appears in both sets, and every prior item appears in exactly one.
        carried_ids = {id(c.item) for c in result.carried_forward}
        invalidated_ids = {id(c.item) for c in result.invalidated}
        assert carried_ids.isdisjoint(invalidated_ids)

    @settings(max_examples=150)
    @given(
        fingerprint_map=st.dictionaries(
            keys=_span_indices, values=_fingerprints, min_size=0, max_size=8
        ),
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
    )
    def test_all_spans_new_when_no_prior_items(
        self,
        fingerprint_map: dict[int, str],
        categories: tuple[str, ...],
        tone: str,
        density: str,
    ) -> None:
        """With no prior cached items, every current span is reported as new
        (Requirement 49.1: cost savings only apply once something is cached)."""
        config = _config(categories, tone, density)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[],
            current_span_fingerprints=fingerprint_map,
            current_config=config,
        )

        assert set(result.new_span_indices) == set(fingerprint_map.keys())
        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 0

    @settings(max_examples=100)
    @given(
        span_fp=_fingerprints,
        para=_span_indices,
        categories=_category_tuples,
        tone=_tones,
        density=_densities,
        minutes_later=st.integers(min_value=1, max_value=10_000),
    )
    def test_config_timestamp_alone_does_not_invalidate(
        self,
        span_fp: str,
        para: int,
        categories: tuple[str, ...],
        tone: str,
        density: str,
        minutes_later: int,
    ) -> None:
        """Only the config *content* hash governs invalidation — creating an
        identical-content snapshot at a later timestamp must not spuriously
        invalidate a carry-forward candidate (Requirement 27.3 is about
        content changes, not timestamps in isolation)."""
        config_a = ConfigSnapshot.from_config(
            category_names=categories, tone=tone, density=density, updated_at=_EPOCH
        )
        config_b = ConfigSnapshot.from_config(
            category_names=categories,
            tone=tone,
            density=density,
            updated_at=_EPOCH + timedelta(minutes=minutes_later),
        )
        cached = _cached_inline(config_a, span_fp, para)
        cache = CarryForwardCache()

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={para: span_fp},
            current_config=config_b,
        )

        assert config_a.config_hash == config_b.config_hash
        assert len(result.carried_forward) == 1
        assert len(result.invalidated) == 0
