"""Decide whether a Bedrock feedback generation can be persisted."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# EMF namespace shared with the other Feedback Engine metrics. Only ``workload``
# is a dimension: no user, document, draft, or job identifiers.
JOB_BINDING_EMF_NAMESPACE = "WREN/FeedbackEngine"
JOB_BINDING_REJECTED_METRIC = "JobBindingRejected"


class NonRetryableFeedbackError(Exception):
    """Job failed in a way that retrying the same prompt will not help."""


class TruncatedFeedbackError(NonRetryableFeedbackError):
    """Model hit max_tokens; the JSON array is incomplete."""


class JobBindingRejectedError(NonRetryableFeedbackError):
    """SQS message ids failed the DB ownership / draft↔document re-derivation.

    The ids on a rejected message are unverified (possibly forged by a
    principal with queue-write or DLQ-redrive rights), so they MUST NOT be
    echoed to any sink — AppSync publish, notifications, or DB writes.
    Subclasses NonRetryableFeedbackError so callers that only know the parent
    still treat it as non-retryable; handlers must catch this class first.
    """


def emit_job_binding_rejected_metric(
    *,
    workload: str = "feedback_primary",
    timestamp_ms: Optional[int] = None,
    sink: Optional[Callable[[str], None]] = None,
) -> None:
    """Emit one EMF line counting a rejected (likely forged) feedback job.

    Carries no identifiers. Never raises: telemetry must not break the batch.
    """
    out = sink if sink is not None else print
    event: dict[str, Any] = {
        "_aws": {
            "Timestamp": timestamp_ms
            if timestamp_ms is not None
            else int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": JOB_BINDING_EMF_NAMESPACE,
                    "Dimensions": [["workload"]],
                    "Metrics": [
                        {"Name": JOB_BINDING_REJECTED_METRIC, "Unit": "Count"},
                    ],
                }
            ],
        },
        "workload": workload,
        JOB_BINDING_REJECTED_METRIC: 1,
    }
    try:
        out(json.dumps(event))
    except Exception:  # noqa: BLE001 — telemetry is best-effort
        logger.debug("Failed to emit JobBindingRejected EMF event", exc_info=True)


def require_complete_feedback_output(stop_reason: str | None, item_count: int) -> None:
    """Raise if the model output must not be persisted as a successful debrief.

    Recovered items from a ``max_tokens`` stop are persistable (strengths are
    emitted first, so a truncated array is often still a usable debrief).
    ``max_tokens`` with zero recovered items is non-retryable: the same prompt
    will overflow again. An empty parse on a normal stop is retryable.
    """
    reason = (stop_reason or "").strip().lower()
    if item_count > 0:
        return
    if reason == "max_tokens":
        raise TruncatedFeedbackError(
            "Bedrock stopped at max_tokens; feedback JSON is truncated"
        )
    raise RuntimeError("No feedback items parsed from model output")


def coerce_draft_segments(raw: object) -> list[dict]:
    """Normalize a ``draft.segments`` jsonb value (string or already-parsed list)."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if isinstance(raw, list):
        return raw
    return []
