"""Decide whether a Bedrock feedback generation can be persisted."""

from __future__ import annotations

import json


class NonRetryableFeedbackError(Exception):
    """Job failed in a way that retrying the same prompt will not help."""


class TruncatedFeedbackError(NonRetryableFeedbackError):
    """Model hit max_tokens; the JSON array is incomplete."""


def require_complete_feedback_output(stop_reason: str | None, item_count: int) -> None:
    """Raise if the model output must not be persisted as a successful debrief.

    ``max_tokens`` is non-retryable: the same prompt will overflow again.
    An empty parse is retryable (transient malformed JSON).
    """
    reason = (stop_reason or "").strip().lower()
    if reason == "max_tokens":
        raise TruncatedFeedbackError(
            "Bedrock stopped at max_tokens; feedback JSON is truncated"
        )
    if item_count <= 0:
        raise RuntimeError("No feedback items parsed from model output")


def coerce_draft_segments(raw: object) -> list[dict]:
    """Normalize a ``draft.segments`` jsonb value (string or already-parsed list)."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if isinstance(raw, list):
        return raw
    return []
