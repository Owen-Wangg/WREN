"""Tests for carry-forward caching and invalidation (Task 9.10).

Validates that the CarryForwardCache:
- Carries forward items with unchanged text and config
- Invalidates items when text changes
- Invalidates items when config changes
- Handles structural items (full document hash)
- Identifies new spans needing generation
"""
from datetime import datetime, timezone

import pytest

from wren_engine.carry_forward import (
    CacheKey,
    CachedFeedbackItem,
    CarryForwardCache,
    CarryForwardDecision,
    ConfigSnapshot,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem
from wren_engine.structural_feedback import StructuralFeedbackItem


# ─── Helpers ───────────────────────────────────────────────────────────────────


def _config(
    categories: tuple[str, ...] = ("A", "B"),
    tone: str = "formal",
    density: str = "medium",
    updated_at: datetime | None = None,
) -> ConfigSnapshot:
    return ConfigSnapshot.from_config(
        category_names=categories,
        tone=tone,
        density=density,
        updated_at=updated_at or datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def _inline_item(category: str = "Grammar", para: int = 0) -> ValidatedFeedbackItem:
    return ValidatedFeedbackItem(
        category=category,
        question="Is this correct?",
        anchor={"start": para * 100, "end": para * 100 + 50, "paragraph": para},
        citation=None,
    )


def _structural_item(category: str = "Organization") -> StructuralFeedbackItem:
    return StructuralFeedbackItem(
        category=category,
        question="How is this structured?",
    )


def _cached_inline(
    config: ConfigSnapshot,
    span_fp: str = "fp_abc",
    para: int = 0,
) -> CachedFeedbackItem:
    return CachedFeedbackItem(
        item=_inline_item(para=para),
        cache_key=CacheKey(span_fingerprint=span_fp, config_hash=config.config_hash),
        generated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        config_snapshot=config,
    )


def _cached_structural(
    config: ConfigSnapshot,
    doc_hash: str = "doc_hash_123",
) -> CachedFeedbackItem:
    return CachedFeedbackItem(
        item=_structural_item(),
        cache_key=CacheKey(
            span_fingerprint=doc_hash,
            config_hash=config.config_hash,
            is_structural=True,
        ),
        generated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        config_snapshot=config,
    )


@pytest.fixture
def cache() -> CarryForwardCache:
    return CarryForwardCache()


# ─── Carry-forward (unchanged) ────────────────────────────────────────────────


class TestCarryForward:
    def test_carries_forward_when_text_and_config_unchanged(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        cached = _cached_inline(config, span_fp="fp_abc", para=0)

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_abc"},
            current_config=config,
        )

        assert len(result.carried_forward) == 1
        assert len(result.invalidated) == 0

    def test_carries_forward_structural_when_doc_unchanged(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        cached = _cached_structural(config, doc_hash="doc_hash_123")

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_abc"},
            current_config=config,
            current_doc_hash="doc_hash_123",
        )

        assert len(result.carried_forward) == 1
        assert len(result.invalidated) == 0

    def test_carries_forward_multiple_items(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        cached1 = _cached_inline(config, span_fp="fp_1", para=0)
        cached2 = _cached_inline(config, span_fp="fp_2", para=1)

        result = cache.evaluate(
            prior_items=[cached1, cached2],
            current_span_fingerprints={0: "fp_1", 1: "fp_2"},
            current_config=config,
        )

        assert len(result.carried_forward) == 2
        assert len(result.invalidated) == 0


# ─── Invalidation ─────────────────────────────────────────────────────────────


class TestInvalidation:
    def test_invalidates_when_text_changes(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        cached = _cached_inline(config, span_fp="fp_old", para=0)

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_new"},  # Different fingerprint
            current_config=config,
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    def test_invalidates_when_config_changes(
        self, cache: CarryForwardCache
    ) -> None:
        old_config = _config(categories=("A", "B"))
        new_config = _config(categories=("A", "B", "C"))  # Added category
        cached = _cached_inline(old_config, span_fp="fp_abc", para=0)

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_abc"},
            current_config=new_config,  # Different config
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    def test_invalidates_structural_when_doc_changes(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        cached = _cached_structural(config, doc_hash="old_hash")

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_abc"},
            current_config=config,
            current_doc_hash="new_hash",  # Document changed
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    def test_invalidates_structural_when_no_doc_hash_provided(
        self, cache: CarryForwardCache
    ) -> None:
        """Conservative: no doc hash means we can't verify, so invalidate."""
        config = _config()
        cached = _cached_structural(config, doc_hash="some_hash")

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_abc"},
            current_config=config,
            current_doc_hash=None,
        )

        assert len(result.carried_forward) == 0
        assert len(result.invalidated) == 1

    def test_mixed_carry_forward_and_invalidation(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        unchanged = _cached_inline(config, span_fp="fp_same", para=0)
        changed = _cached_inline(config, span_fp="fp_old", para=1)

        result = cache.evaluate(
            prior_items=[unchanged, changed],
            current_span_fingerprints={0: "fp_same", 1: "fp_different"},
            current_config=config,
        )

        assert len(result.carried_forward) == 1
        assert len(result.invalidated) == 1


# ─── New spans ─────────────────────────────────────────────────────────────────


class TestNewSpans:
    def test_identifies_new_spans(self, cache: CarryForwardCache) -> None:
        config = _config()
        cached = _cached_inline(config, span_fp="fp_0", para=0)

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_0", 1: "fp_1", 2: "fp_2"},
            current_config=config,
        )

        assert 1 in result.new_span_indices
        assert 2 in result.new_span_indices
        assert 0 not in result.new_span_indices

    def test_all_spans_new_when_no_prior_items(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()

        result = cache.evaluate(
            prior_items=[],
            current_span_fingerprints={0: "fp_0", 1: "fp_1"},
            current_config=config,
        )

        assert result.new_span_indices == (0, 1)
        assert len(result.carried_forward) == 0

    def test_no_new_spans_when_all_covered(
        self, cache: CarryForwardCache
    ) -> None:
        config = _config()
        cached = _cached_inline(config, span_fp="fp_0", para=0)

        result = cache.evaluate(
            prior_items=[cached],
            current_span_fingerprints={0: "fp_0"},
            current_config=config,
        )

        assert result.new_span_indices == ()


# ─── ConfigSnapshot ────────────────────────────────────────────────────────────


class TestConfigSnapshot:
    def test_same_config_produces_same_hash(self) -> None:
        c1 = _config(categories=("A", "B"), tone="formal")
        c2 = _config(categories=("A", "B"), tone="formal")
        assert c1.config_hash == c2.config_hash

    def test_different_categories_produce_different_hash(self) -> None:
        c1 = _config(categories=("A", "B"))
        c2 = _config(categories=("A", "B", "C"))
        assert c1.config_hash != c2.config_hash

    def test_different_tone_produces_different_hash(self) -> None:
        c1 = _config(tone="formal")
        c2 = _config(tone="casual")
        assert c1.config_hash != c2.config_hash

    def test_different_density_produces_different_hash(self) -> None:
        c1 = _config(density="low")
        c2 = _config(density="high")
        assert c1.config_hash != c2.config_hash


# ─── Utility methods ───────────────────────────────────────────────────────────


class TestUtilities:
    def test_compute_document_hash_deterministic(self) -> None:
        h1 = CarryForwardCache.compute_document_hash("Hello world")
        h2 = CarryForwardCache.compute_document_hash("Hello world")
        assert h1 == h2

    def test_compute_document_hash_changes_with_content(self) -> None:
        h1 = CarryForwardCache.compute_document_hash("Hello world")
        h2 = CarryForwardCache.compute_document_hash("Hello world!")
        assert h1 != h2

    def test_make_cache_key_inline(self) -> None:
        config = _config()
        key = CarryForwardCache.make_cache_key_inline("fp_abc", config)
        assert key.span_fingerprint == "fp_abc"
        assert key.config_hash == config.config_hash
        assert key.is_structural is False

    def test_make_cache_key_structural(self) -> None:
        config = _config()
        key = CarryForwardCache.make_cache_key_structural("doc_hash", config)
        assert key.span_fingerprint == "doc_hash"
        assert key.config_hash == config.config_hash
        assert key.is_structural is True
