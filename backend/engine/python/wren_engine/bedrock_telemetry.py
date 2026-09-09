"""Bedrock invocation telemetry — OBSERVE MODE (prompt-cache plan Task 3).

Python mirror of ``backend/feedback/src/bedrockTelemetry.ts``. Pure
instrumentation: this module NEVER adds ``cache_control`` markers, NEVER changes
prompt text/ordering, and NEVER changes model output or error behavior. It only:

  1. Normalizes the Anthropic ``usage`` block from a decoded InvokeModel response
     into a typed :class:`InvocationUsage` (missing/partial usage → 0).
  2. Estimates per-request cost against a versioned price registry (plan §8/§9).
     Unknown models yield ``None`` estimates (cost fields omitted, never faked).
  3. Emits a CloudWatch Embedded Metric Format (EMF) event via ``print`` (Lambda
     scrapes stdout) plus a structured, privacy-safe log line.

PRIVACY (plan §16): never log prompt text; never use user / document / draft /
department / job identifiers as metric dimensions or metric fields. Only
``workload`` and ``modelId`` are permitted dimensions. A Bedrock requestId may
appear in the structured log line but never as a dimension.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional

# EMF namespace for all WREN Bedrock metrics.
EMF_NAMESPACE = "WREN/Bedrock"

# Permitted workload labels (plan §14 strategy matrix).
WORKLOADS = frozenset(
    {
        "ask_wren",
        "feedback_primary",
        "strength_fill",
        "quote_fill",
        "resolution_judge",
    }
)


@dataclass(frozen=True)
class InvocationUsage:
    """Normalized token usage plus invocation metadata.

    Token counts default to 0 when the model omits them (older/other models or no
    caching activity).
    """

    modelId: str
    workload: str
    latencyMs: float
    stopReason: str = ""
    success: bool = True
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    fallbackReason: Optional[str] = None


@dataclass(frozen=True)
class ModelRates:
    """Per-1M-token rates. Absence of an entry → cost is omitted, not faked."""

    input_per_million: float
    cache_write_5m_per_million: float
    cache_write_1h_per_million: float
    cache_read_per_million: float
    output_per_million: float


@dataclass(frozen=True)
class PriceRegistryEntry:
    """A single versioned price entry keyed by model id + effective date (§8)."""

    modelId: str
    effective_date: date
    rates: ModelRates


# Versioned price registry (plan §8). Do NOT hardcode rates in invocation code —
# always resolve via ``resolve_model_rates``. Seeded for Claude Sonnet 4.6.
PRICE_REGISTRY: tuple[PriceRegistryEntry, ...] = (
    PriceRegistryEntry(
        modelId="us.anthropic.claude-sonnet-4-6",
        effective_date=date(2026, 9, 3),
        rates=ModelRates(
            input_per_million=3.00,
            cache_write_5m_per_million=3.75,
            cache_write_1h_per_million=6.00,
            cache_read_per_million=0.30,
            output_per_million=15.00,
        ),
    ),
)


def resolve_model_rates(
    model_id: str, as_of: Optional[date] = None
) -> Optional[ModelRates]:
    """Return the most recent rates for ``model_id`` effective on/before ``as_of``.

    Returns ``None`` for unknown models so callers omit cost fields (no crash).
    """
    if as_of is None:
        as_of = datetime.now(timezone.utc).date()
    best: Optional[PriceRegistryEntry] = None
    for entry in PRICE_REGISTRY:
        if entry.modelId != model_id:
            continue
        if entry.effective_date > as_of:
            continue
        if best is None or entry.effective_date > best.effective_date:
            best = entry
    return best.rates if best else None


def _to_token_count(value: Any) -> int:
    """Coerce an arbitrary value to a finite, non-negative integer token count."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return n if n >= 0 else 0


def parse_invocation_usage(decoded_response: Any) -> dict[str, int]:
    """Defensively read the Anthropic ``usage`` block from a decoded response.

    Tolerates a missing/partial/non-dict ``usage`` (older or non-Anthropic
    models) by defaulting each token field to 0. Never raises.
    """
    usage = {}
    if isinstance(decoded_response, dict):
        candidate = decoded_response.get("usage")
        if isinstance(candidate, dict):
            usage = candidate
    return {
        "input_tokens": _to_token_count(usage.get("input_tokens")),
        "output_tokens": _to_token_count(usage.get("output_tokens")),
        "cache_creation_input_tokens": _to_token_count(
            usage.get("cache_creation_input_tokens")
        ),
        "cache_read_input_tokens": _to_token_count(
            usage.get("cache_read_input_tokens")
        ),
    }


@dataclass(frozen=True)
class CostEstimate:
    """Estimated per-request cost breakdown (USD)."""

    actual_usd: float
    uncached_equiv_usd: float
    savings_usd: float


def estimate_cost(
    usage: dict[str, int] | InvocationUsage,
    rates: Optional[ModelRates],
    ttl: str = "5m",
) -> Optional[CostEstimate]:
    """Compute per-request cost per plan §9.

    Returns ``None`` when the model has no registry rates (cost omitted, never
    faked). In observe mode cache tokens are 0, so actual == uncached_equiv and
    savings == 0 — the intended uncached baseline.
    """
    if rates is None:
        return None

    if isinstance(usage, InvocationUsage):
        input_tokens = usage.input_tokens
        output_tokens = usage.output_tokens
        cache_write = usage.cache_creation_input_tokens
        cache_read = usage.cache_read_input_tokens
    else:
        input_tokens = _to_token_count(usage.get("input_tokens"))
        output_tokens = _to_token_count(usage.get("output_tokens"))
        cache_write = _to_token_count(usage.get("cache_creation_input_tokens"))
        cache_read = _to_token_count(usage.get("cache_read_input_tokens"))

    write_rate = (
        rates.cache_write_1h_per_million
        if ttl == "1h"
        else rates.cache_write_5m_per_million
    )

    actual = (
        input_tokens * rates.input_per_million
        + cache_write * write_rate
        + cache_read * rates.cache_read_per_million
        + output_tokens * rates.output_per_million
    ) / 1_000_000

    uncached_equiv = (
        (input_tokens + cache_write + cache_read) * rates.input_per_million
        + output_tokens * rates.output_per_million
    ) / 1_000_000

    return CostEstimate(
        actual_usd=actual,
        uncached_equiv_usd=uncached_equiv,
        savings_usd=uncached_equiv - actual,
    )


def build_emf_event(
    usage: InvocationUsage,
    *,
    cache_eligible: bool = False,
    cache_fallback: bool = False,
    ttl: str = "5m",
    timestamp_ms: Optional[int] = None,
) -> dict[str, Any]:
    """Build the EMF event dict. Dimensions are ALWAYS only [workload, modelId]."""
    rates = resolve_model_rates(usage.modelId)
    cost = estimate_cost(usage, rates, ttl)

    metrics: list[dict[str, str]] = [
        {"Name": "Invocations", "Unit": "Count"},
        {"Name": "InputTokens", "Unit": "Count"},
        {"Name": "OutputTokens", "Unit": "Count"},
        {"Name": "CacheWriteInputTokens", "Unit": "Count"},
        {"Name": "CacheReadInputTokens", "Unit": "Count"},
        {"Name": "CacheEligibleInvocations", "Unit": "Count"},
        {"Name": "CacheFallbacks", "Unit": "Count"},
        {"Name": "InvocationLatency", "Unit": "Milliseconds"},
    ]
    if cost is not None:
        metrics.append({"Name": "EstimatedCostUsd", "Unit": "None"})
        metrics.append({"Name": "EstimatedSavingsUsd", "Unit": "None"})

    event: dict[str, Any] = {
        "_aws": {
            "Timestamp": timestamp_ms
            if timestamp_ms is not None
            else int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": EMF_NAMESPACE,
                    # ONLY workload + modelId are permitted dimensions (§16).
                    "Dimensions": [["workload", "modelId"]],
                    "Metrics": metrics,
                }
            ],
        },
        "workload": usage.workload,
        "modelId": usage.modelId,
        "Invocations": 1,
        "InputTokens": usage.input_tokens,
        "OutputTokens": usage.output_tokens,
        "CacheWriteInputTokens": usage.cache_creation_input_tokens,
        "CacheReadInputTokens": usage.cache_read_input_tokens,
        "CacheEligibleInvocations": 1 if cache_eligible else 0,
        "CacheFallbacks": 1 if cache_fallback else 0,
        "InvocationLatency": usage.latencyMs,
    }
    if cost is not None:
        event["EstimatedCostUsd"] = cost.actual_usd
        event["EstimatedSavingsUsd"] = cost.savings_usd
    return event


def build_log_line(
    usage: InvocationUsage,
    *,
    cache_eligible: bool = False,
    request_id: Optional[str] = None,
    ttl: str = "5m",
) -> dict[str, Any]:
    """Build the privacy-safe structured log line dict."""
    rates = resolve_model_rates(usage.modelId)
    cost = estimate_cost(usage, rates, ttl)
    line: dict[str, Any] = {
        "event": "bedrock_invocation",
        "workload": usage.workload,
        "modelId": usage.modelId,
        "success": usage.success,
        "stopReason": usage.stopReason,
        "latencyMs": usage.latencyMs,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_creation_input_tokens": usage.cache_creation_input_tokens,
        "cache_read_input_tokens": usage.cache_read_input_tokens,
        "cacheEligible": bool(cache_eligible),
    }
    if usage.fallbackReason:
        line["fallbackReason"] = usage.fallbackReason
    if request_id:
        # Request id is allowed in logs only, never as a metric dimension.
        line["requestId"] = request_id
    if cost is not None:
        line["estimatedCostUsd"] = cost.actual_usd
        line["estimatedSavingsUsd"] = cost.savings_usd
    return line


def emit_telemetry(
    usage: InvocationUsage,
    *,
    cache_eligible: bool = False,
    cache_fallback: bool = False,
    ttl: str = "5m",
    request_id: Optional[str] = None,
    timestamp_ms: Optional[int] = None,
    sink: Optional[Callable[[str], None]] = None,
) -> None:
    """Emit one EMF JSON line and one structured log line to stdout.

    Never raises — observe-mode telemetry must not affect the caller's return
    value or error behavior.
    """
    out = sink if sink is not None else print
    try:
        emf = build_emf_event(
            usage,
            cache_eligible=cache_eligible,
            cache_fallback=cache_fallback,
            ttl=ttl,
            timestamp_ms=timestamp_ms,
        )
        log = build_log_line(
            usage,
            cache_eligible=cache_eligible,
            request_id=request_id,
            ttl=ttl,
        )
        out(json.dumps(emf))
        out(json.dumps(log))
    except Exception:
        # Swallow — telemetry must never break the request path.
        pass
