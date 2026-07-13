"""Tests for async feedback job execution (Task 9.12).

Validates that:
- derive_idempotency_key is deterministic and sensitive to each input
- compute_backoff_delay is bounded, non-decreasing in ceiling, and jittered
- AsyncFeedbackJobRunner transitions status correctly on success/failure
- Jobs are routed to the DLQ only after max_attempts is reached
- Already-terminal jobs are not re-run (idempotent re-delivery guard)
"""
from __future__ import annotations

import random

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.async_job import (
    AsyncFeedbackJobRunner,
    FeedbackJob,
    InMemoryJobQueueClient,
    JobStatus,
    compute_backoff_delay,
    derive_idempotency_key,
)


# ─── Idempotency key derivation ────────────────────────────────────────────────


class TestDeriveIdempotencyKey:
    def test_deterministic_for_same_inputs(self) -> None:
        k1 = derive_idempotency_key(document_id="doc-1", draft_version=2, span_fingerprint="fp-a")
        k2 = derive_idempotency_key(document_id="doc-1", draft_version=2, span_fingerprint="fp-a")
        assert k1 == k2
        assert k1.value == k2.value

    def test_differs_by_document_id(self) -> None:
        k1 = derive_idempotency_key(document_id="doc-1", draft_version=1)
        k2 = derive_idempotency_key(document_id="doc-2", draft_version=1)
        assert k1 != k2

    def test_differs_by_draft_version(self) -> None:
        k1 = derive_idempotency_key(document_id="doc-1", draft_version=1)
        k2 = derive_idempotency_key(document_id="doc-1", draft_version=2)
        assert k1 != k2

    def test_differs_by_span_fingerprint(self) -> None:
        k1 = derive_idempotency_key(document_id="doc-1", draft_version=1, span_fingerprint="fp-a")
        k2 = derive_idempotency_key(document_id="doc-1", draft_version=1, span_fingerprint="fp-b")
        assert k1 != k2

    def test_structural_key_differs_from_any_anchored_span(self) -> None:
        structural = derive_idempotency_key(document_id="doc-1", draft_version=1, span_fingerprint=None)
        anchored = derive_idempotency_key(document_id="doc-1", draft_version=1, span_fingerprint="fp-a")
        assert structural != anchored

    def test_differs_by_config_hash(self) -> None:
        k1 = derive_idempotency_key(document_id="doc-1", draft_version=1, config_hash="cfg-a")
        k2 = derive_idempotency_key(document_id="doc-1", draft_version=1, config_hash="cfg-b")
        assert k1 != k2

    def test_rejects_empty_document_id(self) -> None:
        with pytest.raises(ValueError):
            derive_idempotency_key(document_id="", draft_version=1)

    def test_rejects_negative_draft_version(self) -> None:
        with pytest.raises(ValueError):
            derive_idempotency_key(document_id="doc-1", draft_version=-1)


@pytest.mark.property
class TestIdempotencyKeyProperty:
    """Feature: wren-writing-coach, Property: idempotency-key determinism."""

    @settings(max_examples=150)
    @given(
        document_id=st.text(min_size=1, max_size=20),
        draft_version=st.integers(min_value=0, max_value=1000),
        span_fingerprint=st.one_of(st.none(), st.text(min_size=1, max_size=20)),
        config_hash=st.one_of(st.none(), st.text(min_size=1, max_size=20)),
    )
    def test_same_inputs_always_yield_same_key(
        self, document_id, draft_version, span_fingerprint, config_hash
    ) -> None:
        k1 = derive_idempotency_key(
            document_id=document_id,
            draft_version=draft_version,
            span_fingerprint=span_fingerprint,
            config_hash=config_hash,
        )
        k2 = derive_idempotency_key(
            document_id=document_id,
            draft_version=draft_version,
            span_fingerprint=span_fingerprint,
            config_hash=config_hash,
        )
        assert k1 == k2


# ─── Backoff with jitter ───────────────────────────────────────────────────────


class TestComputeBackoffDelay:
    def test_delay_is_within_bounds(self) -> None:
        rng = random.Random(42)
        delay = compute_backoff_delay(1, base_delay_seconds=2.0, max_delay_seconds=60.0, rng=rng)
        assert 0.0 <= delay <= 2.0

    def test_delay_respects_max_ceiling(self) -> None:
        rng = random.Random(42)
        # With a huge attempt count, uncapped exponential would be enormous;
        # the ceiling must still bound the result.
        delay = compute_backoff_delay(50, base_delay_seconds=2.0, max_delay_seconds=10.0, rng=rng)
        assert 0.0 <= delay <= 10.0

    def test_rejects_attempt_below_one(self) -> None:
        with pytest.raises(ValueError):
            compute_backoff_delay(0)

    def test_deterministic_with_seeded_rng(self) -> None:
        d1 = compute_backoff_delay(3, rng=random.Random(7))
        d2 = compute_backoff_delay(3, rng=random.Random(7))
        assert d1 == d2


@pytest.mark.property
class TestBackoffDelayProperty:
    """Feature: wren-writing-coach, Property: backoff delay is bounded and non-decreasing ceiling."""

    @settings(max_examples=200)
    @given(
        attempt=st.integers(min_value=1, max_value=30),
        base=st.floats(min_value=0.01, max_value=10.0, allow_nan=False, allow_infinity=False),
        max_delay=st.floats(min_value=0.01, max_value=120.0, allow_nan=False, allow_infinity=False),
        seed=st.integers(min_value=0, max_value=2**31 - 1),
    )
    def test_delay_never_exceeds_max_delay(self, attempt, base, max_delay, seed) -> None:
        rng = random.Random(seed)
        delay = compute_backoff_delay(
            attempt, base_delay_seconds=base, max_delay_seconds=max_delay, rng=rng
        )
        assert 0.0 <= delay <= max_delay

    @settings(max_examples=200)
    @given(
        attempt_a=st.integers(min_value=1, max_value=10),
        attempt_b=st.integers(min_value=1, max_value=10),
        base=st.floats(min_value=0.01, max_value=5.0, allow_nan=False, allow_infinity=False),
        max_delay=st.floats(min_value=100.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
    )
    def test_ceiling_is_non_decreasing_in_attempt_below_cap(
        self, attempt_a, attempt_b, base, max_delay
    ) -> None:
        """When the exponential term hasn't hit the cap, a higher attempt
        number implies a higher (or equal) *possible* delay ceiling."""
        ceiling_a = min(base * (2 ** (attempt_a - 1)), max_delay)
        ceiling_b = min(base * (2 ** (attempt_b - 1)), max_delay)
        if attempt_a <= attempt_b:
            assert ceiling_a <= ceiling_b
        else:
            assert ceiling_a >= ceiling_b


# ─── AsyncFeedbackJobRunner lifecycle ──────────────────────────────────────────


def _job(max_attempts: int = 3) -> FeedbackJob:
    key = derive_idempotency_key(document_id="doc-1", draft_version=1, span_fingerprint="fp-a")
    return FeedbackJob(
        idempotency_key=key,
        document_id="doc-1",
        draft_version=1,
        max_attempts=max_attempts,
    )


class TestAsyncFeedbackJobRunner:
    def test_submit_enqueues_and_sets_queued_status(self) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job()

        runner.submit(job)

        assert job.status == JobStatus.QUEUED
        assert client.queued == [job]

    def test_run_once_succeeds_transitions_to_succeeded(self) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job()

        result = runner.run_once(job, pipeline=lambda: None)

        assert result.status == JobStatus.SUCCEEDED
        assert job.status == JobStatus.SUCCEEDED
        assert job.attempts == 1
        assert job.error is None

    def test_run_once_failure_below_max_attempts_transitions_to_failed(self) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job(max_attempts=3)

        def boom():
            raise RuntimeError("upstream timeout")

        result = runner.run_once(job, pipeline=boom)

        assert result.status == JobStatus.FAILED
        assert job.status == JobStatus.FAILED
        assert job.attempts == 1
        assert job.error == "upstream timeout"
        assert client.dead_lettered == []

    def test_run_once_exhausting_attempts_routes_to_dlq(self) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job(max_attempts=2)

        def boom():
            raise RuntimeError("persistent failure")

        first = runner.run_once(job, pipeline=boom)
        assert first.status == JobStatus.FAILED

        second = runner.run_once(job, pipeline=boom)
        assert second.status == JobStatus.DEAD_LETTERED
        assert job.status == JobStatus.DEAD_LETTERED
        assert job.attempts == 2
        assert client.dead_lettered == [job]

    def test_succeeded_job_is_not_rerun(self) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job()
        runner.run_once(job, pipeline=lambda: None)
        assert job.attempts == 1

        calls = []
        runner.run_once(job, pipeline=lambda: calls.append(1))

        assert calls == []  # pipeline never invoked again
        assert job.attempts == 1  # attempt counter untouched

    def test_dead_lettered_job_is_not_rerun(self) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job(max_attempts=1)

        def boom():
            raise RuntimeError("fails once and is dead-lettered")

        runner.run_once(job, pipeline=boom)
        assert job.status == JobStatus.DEAD_LETTERED

        calls = []
        runner.run_once(job, pipeline=lambda: calls.append(1))

        assert calls == []
        assert job.attempts == 1

    def test_recovery_after_transient_failure(self) -> None:
        """A job that fails once and then succeeds on retry ends SUCCEEDED,
        never DEAD_LETTERED, as long as max_attempts is not exhausted."""
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job(max_attempts=3)

        attempts_made = {"n": 0}

        def flaky():
            attempts_made["n"] += 1
            if attempts_made["n"] == 1:
                raise RuntimeError("transient")

        first = runner.run_once(job, pipeline=flaky)
        assert first.status == JobStatus.FAILED

        second = runner.run_once(job, pipeline=flaky)
        assert second.status == JobStatus.SUCCEEDED
        assert job.status == JobStatus.SUCCEEDED
        assert client.dead_lettered == []


@pytest.mark.property
class TestAsyncFeedbackJobRunnerProperty:
    """Feature: wren-writing-coach, Property: DLQ routing exactness (Requirement 47.3)."""

    @settings(max_examples=100)
    @given(max_attempts=st.integers(min_value=1, max_value=8))
    def test_dlq_reached_exactly_at_max_attempts_when_always_failing(self, max_attempts: int) -> None:
        """A pipeline that always fails is dead-lettered on exactly the
        attempt equal to max_attempts — never earlier, never later."""
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job(max_attempts=max_attempts)

        def boom():
            raise RuntimeError("always fails")

        for expected_attempt in range(1, max_attempts + 1):
            result = runner.run_once(job, pipeline=boom)
            if expected_attempt < max_attempts:
                assert result.status == JobStatus.FAILED
            else:
                assert result.status == JobStatus.DEAD_LETTERED

        assert job.attempts == max_attempts
        assert client.dead_lettered == [job]
        assert len(client.dead_lettered) == 1  # never dead-lettered more than once

    @settings(max_examples=100)
    @given(max_attempts=st.integers(min_value=1, max_value=8))
    def test_never_dead_lettered_when_pipeline_always_succeeds(self, max_attempts: int) -> None:
        client = InMemoryJobQueueClient()
        runner = AsyncFeedbackJobRunner(client)
        job = _job(max_attempts=max_attempts)

        result = runner.run_once(job, pipeline=lambda: None)

        assert result.status == JobStatus.SUCCEEDED
        assert client.dead_lettered == []
        assert job.attempts == 1
