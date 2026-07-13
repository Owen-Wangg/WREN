"""Async feedback job execution (Task 9.12).

Wires the Feedback Engine's synchronous pipeline (prompt assembly -> model
invocation -> output guardrail -> classification/density -> structural
feedback -> citation attachment -> carry-forward) behind an asynchronous
job so the API can enqueue generation and return immediately, while the
client observes progress via streamed or polled status
(REQ-NFR-LATENCY-01 criterion 2, design.md "Feedback generation runs as an
asynchronous job").

This module is pure orchestration/state-machine logic with **no** direct
AWS SDK dependency: the actual SQS queue + DLQ are provisioned by the CDK
`Compute` stack (Task 16.2); this module defines:

1. :class:`JobQueueClient` — an injectable protocol for enqueueing a job and
   acknowledging/dead-lettering a message, satisfied in production by an
   SQS-backed adapter and in tests by an in-memory stub (same injection
   pattern as :class:`~wren_engine.model_invocation.ModelInvoker`).
2. :class:`FeedbackJob` / :class:`JobStatus` — the job status state machine
   the client polls or receives via a stream (REQ-NFR-LATENCY-01
   criterion 2): ``queued -> in_progress -> (succeeded | failed)``, with
   ``failed`` jobs that exhaust retries transitioning to ``dead_lettered``.
3. :func:`compute_backoff_delay` — exponential backoff with jitter for
   retrying a failed job (design.md "Reliability": "idempotent handlers,
   retries with exponential backoff and jitter, and a dead-letter queue").
4. :class:`IdempotencyKey` / :func:`derive_idempotency_key` — a stable,
   deterministic key derived from (document_id, draft_version, span
   fingerprint or "structural") so re-delivered SQS messages (at-least-once
   delivery) never produce duplicate Feedback Items
   (design.md "idempotent handlers").
5. :class:`AsyncFeedbackJobRunner` — orchestrates a single job's lifecycle:
   enqueue, mark in-progress, run the caller-supplied pipeline callable,
   record success/failure, and route to the DLQ after the configured
   maximum attempts (REQ-NFR-SCALE-01 criterion 3: "degrade gracefully...
   rather than failing requests without explanation").

Design references:
  - design.md "Feedback generation latency target is 10s for ~500 words...
    Feedback runs as an asynchronous job: the API enqueues generation and
    the client receives streamed/poll-based status."
  - design.md "Compute": "SQS queue + DLQ for async feedback jobs."
  - design.md "Reliability": "Async feedback jobs use idempotent handlers,
    retries with exponential backoff and jitter, and a dead-letter queue."
  - requirements.md Requirement 47 (REQ-NFR-SCALE-01) criterion 3,
    Requirement 48 (REQ-NFR-LATENCY-01) criteria 48.2, 48.3.
"""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional, Protocol, runtime_checkable

__all__ = [
    "JobStatus",
    "FeedbackJob",
    "JobQueueClient",
    "InMemoryJobQueueClient",
    "IdempotencyKey",
    "derive_idempotency_key",
    "compute_backoff_delay",
    "AsyncFeedbackJobRunner",
    "JobResult",
    "DEFAULT_MAX_ATTEMPTS",
    "DEFAULT_BASE_DELAY_SECONDS",
    "DEFAULT_MAX_DELAY_SECONDS",
]

#: Default maximum delivery attempts before a job is routed to the DLQ.
#: Mirrors a typical SQS redrive policy ``maxReceiveCount``.
DEFAULT_MAX_ATTEMPTS = 3

#: Base delay (seconds) for exponential backoff between retries.
DEFAULT_BASE_DELAY_SECONDS = 2.0

#: Ceiling on the computed backoff delay, so retries never wait unboundedly
#: long even after many attempts.
DEFAULT_MAX_DELAY_SECONDS = 60.0


class JobStatus(str, Enum):
    """Status of an async feedback job, as observed by streamed/poll clients.

    REQ-NFR-LATENCY-01 criterion 2: "WHILE feedback generation is in
    progress, THE Feedback_Presenter SHALL display a loading state" — the
    client maps ``QUEUED``/``IN_PROGRESS`` to that loading state,
    ``SUCCEEDED`` to displaying the result, and ``FAILED``/``DEAD_LETTERED``
    to the error state with a retry affordance (criterion 3).
    """

    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DEAD_LETTERED = "dead_lettered"


@dataclass(frozen=True, slots=True)
class IdempotencyKey:
    """A stable, deterministic key identifying one feedback-generation unit.

    Derived from the document/draft/span identity so that at-least-once SQS
    delivery (or a client's own duplicate submit) never causes the same
    span to be processed — and a duplicate Feedback Item persisted — twice
    (design.md "idempotent handlers").
    """

    value: str

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


def derive_idempotency_key(
    *,
    document_id: str,
    draft_version: int,
    span_fingerprint: Optional[str] = None,
    config_hash: Optional[str] = None,
) -> IdempotencyKey:
    """Derive a stable idempotency key for one feedback-generation unit.

    ``span_fingerprint=None`` identifies the document-wide structural
    feedback unit for this draft (Task 9.9) rather than an anchored span.
    Including ``config_hash`` (when supplied) ensures that a job re-queued
    after a Document-Type config change is treated as distinct from a
    stale in-flight duplicate for the pre-change config — this mirrors the
    carry-forward cache's own invalidation-on-config-change rule
    (Task 9.10), rather than silently treating them as the same job.

    Pure/deterministic: the same inputs always yield the same key,
    independent of process, host, or call order.
    """
    if not document_id:
        raise ValueError("document_id must not be empty")
    if draft_version < 0:
        raise ValueError("draft_version must be non-negative")

    hasher = hashlib.sha256()
    hasher.update(document_id.encode("utf-8"))
    hasher.update(b"|")
    hasher.update(str(draft_version).encode("utf-8"))
    hasher.update(b"|")
    hasher.update((span_fingerprint or "__structural__").encode("utf-8"))
    hasher.update(b"|")
    hasher.update((config_hash or "").encode("utf-8"))
    return IdempotencyKey(value=hasher.hexdigest())


def compute_backoff_delay(
    attempt: int,
    *,
    base_delay_seconds: float = DEFAULT_BASE_DELAY_SECONDS,
    max_delay_seconds: float = DEFAULT_MAX_DELAY_SECONDS,
    rng: Optional[random.Random] = None,
) -> float:
    """Compute an exponential-backoff-with-jitter delay for a retry attempt.

    ``attempt`` is 1-indexed (the delay before the *second* attempt is
    ``compute_backoff_delay(1)``, i.e. after the first attempt failed).
    Uses "full jitter" (AWS's recommended strategy): a uniform random delay
    in ``[0, min(max_delay_seconds, base_delay_seconds * 2**(attempt-1))]``,
    which spreads retries out and avoids thundering-herd retry storms
    (design.md "Reliability": "retries with exponential backoff and
    jitter").

    ``rng`` is injectable for deterministic tests; production uses the
    module-level ``random`` generator implicitly via a fresh
    ``random.Random()`` when not supplied.
    """
    if attempt < 1:
        raise ValueError("attempt must be >= 1")
    if base_delay_seconds < 0:
        raise ValueError("base_delay_seconds must be non-negative")
    if max_delay_seconds < 0:
        raise ValueError("max_delay_seconds must be non-negative")

    uncapped = base_delay_seconds * (2 ** (attempt - 1))
    ceiling = min(uncapped, max_delay_seconds)
    generator = rng if rng is not None else random.Random()
    return generator.uniform(0.0, ceiling)


@dataclass
class FeedbackJob:
    """The status record for one async feedback-generation job.

    Mutable (unlike the engine's other frozen dataclasses) because it
    represents in-flight state that a runner updates over the job's
    lifecycle; callers persist/stream snapshots of it rather than mutating
    it concurrently from multiple places.
    """

    idempotency_key: IdempotencyKey
    document_id: str
    draft_version: int
    status: JobStatus = JobStatus.QUEUED
    attempts: int = 0
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    error: Optional[str] = None

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)


@runtime_checkable
class JobQueueClient(Protocol):
    """Injected queue boundary (production: SQS + DLQ; tests: in-memory).

    Mirrors the ``ModelInvoker``/``SpanJudge`` injection pattern used
    elsewhere in ``wren_engine``: orchestration logic here is fully
    testable without a live AWS connection, and the CDK `Compute` stack
    (Task 16.2) supplies the real SQS-backed implementation.
    """

    def enqueue(self, job: FeedbackJob) -> None:
        """Place a job's message on the queue."""
        ...

    def send_to_dlq(self, job: FeedbackJob) -> None:
        """Route a job that exhausted its retries to the dead-letter queue."""
        ...


class InMemoryJobQueueClient:
    """A trivial in-memory :class:`JobQueueClient` for tests and local runs.

    Not used in production (SQS is), but gives the orchestration logic a
    concrete, dependency-free client to exercise without mocks.
    """

    def __init__(self) -> None:
        self.queued: list[FeedbackJob] = []
        self.dead_lettered: list[FeedbackJob] = []

    def enqueue(self, job: FeedbackJob) -> None:
        self.queued.append(job)

    def send_to_dlq(self, job: FeedbackJob) -> None:
        self.dead_lettered.append(job)


@dataclass(frozen=True, slots=True)
class JobResult:
    """The outcome of running a job's pipeline callable once."""

    status: JobStatus
    error: Optional[str] = None


class AsyncFeedbackJobRunner:
    """Orchestrates one feedback job's async lifecycle (Task 9.12).

    Composition, not computation: the actual feedback-generation pipeline
    (prompt assembly -> model invocation -> guardrail -> classification ->
    structural -> citation -> carry-forward) is supplied by the caller as
    ``pipeline`` — a callable that raises on failure and otherwise
    completes normally. This runner's job is purely the async-execution
    contract: idempotent dispatch, in-progress/succeeded/failed status
    transitions, retry backoff, and DLQ routing after
    ``job.max_attempts`` (REQ-NFR-SCALE-01 criterion 3, REQ-NFR-LATENCY-01
    criteria 48.2, 48.3).
    """

    def __init__(self, queue_client: JobQueueClient) -> None:
        self._queue_client = queue_client

    def submit(self, job: FeedbackJob) -> None:
        """Enqueue a new job. Idempotent: callers should look up an existing
        job by ``idempotency_key`` before calling this — this method itself
        does not deduplicate (that is the persistence layer's concern,
        typically a unique constraint on the idempotency key column)."""
        job.status = JobStatus.QUEUED
        job.touch()
        self._queue_client.enqueue(job)

    def run_once(
        self,
        job: FeedbackJob,
        pipeline: Callable[[], Any],
    ) -> JobResult:
        """Execute one delivery attempt of ``job``'s pipeline callable.

        On success: transitions the job to ``SUCCEEDED``.
        On failure: increments ``attempts``; if attempts have now reached
        ``max_attempts``, transitions to ``DEAD_LETTERED`` and routes the
        job to the DLQ via the queue client (design.md "a dead-letter
        queue"); otherwise transitions to ``FAILED`` so the caller can
        re-enqueue after :func:`compute_backoff_delay`.

        A job that is already ``SUCCEEDED`` or ``DEAD_LETTERED`` is a no-op
        (idempotent re-delivery guard): re-running a completed job's
        pipeline again — e.g. from an at-least-once-delivered duplicate
        SQS message — must never re-run side effects or double-persist
        feedback.
        """
        if job.status in (JobStatus.SUCCEEDED, JobStatus.DEAD_LETTERED):
            return JobResult(status=job.status)

        job.status = JobStatus.IN_PROGRESS
        job.attempts += 1
        job.touch()

        try:
            pipeline()
        except Exception as exc:  # noqa: BLE001 - classified into job state below.
            job.error = str(exc)
            if job.attempts >= job.max_attempts:
                job.status = JobStatus.DEAD_LETTERED
                job.touch()
                self._queue_client.send_to_dlq(job)
                return JobResult(status=job.status, error=job.error)

            job.status = JobStatus.FAILED
            job.touch()
            return JobResult(status=job.status, error=job.error)

        job.status = JobStatus.SUCCEEDED
        job.error = None
        job.touch()
        return JobResult(status=job.status)
