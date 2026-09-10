"""Unit tests for the OBSERVE-MODE Bedrock telemetry module (prompt-cache Task 3).

Mirrors the TypeScript suite: defensive usage parsing, table-driven cost calc
(known + unknown model, 5m/1h), EMF event shape, and the privacy invariant that
metric dimensions are ONLY [workload, modelId] and never carry user/document/
draft/department/job identifiers.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wren_engine.bedrock_telemetry import (  # noqa: E402
    EMF_NAMESPACE,
    InvocationUsage,
    build_emf_event,
    build_log_line,
    emit_telemetry,
    estimate_cost,
    parse_invocation_usage,
    resolve_model_rates,
)

KNOWN_MODEL = "us.anthropic.claude-sonnet-4-6"
UNKNOWN_MODEL = "meta.llama3-70b-instruct-v1:0"

FORBIDDEN_KEYS = [
    "userId",
    "documentId",
    "draftId",
    "departmentId",
    "jobId",
    "user_id",
    "document_id",
    "draft_id",
    "department_id",
    "job_id",
]


def _usage(**overrides) -> InvocationUsage:
    base = dict(
        modelId=KNOWN_MODEL,
        workload="feedback_primary",
        latencyMs=12.0,
        stopReason="end_turn",
        success=True,
    )
    base.update(overrides)
    return InvocationUsage(**base)


# ---------------------------------------------------------------- usage parser
def test_parse_full_usage_block():
    parsed = parse_invocation_usage(
        {
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 350,
                "cache_creation_input_tokens": 800,
                "cache_read_input_tokens": 400,
            }
        }
    )
    assert parsed == {
        "input_tokens": 1200,
        "output_tokens": 350,
        "cache_creation_input_tokens": 800,
        "cache_read_input_tokens": 400,
    }


def test_parse_partial_usage_defaults_cache_to_zero():
    parsed = parse_invocation_usage({"usage": {"input_tokens": 500, "output_tokens": 120}})
    assert parsed == {
        "input_tokens": 500,
        "output_tokens": 120,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }


def test_parse_missing_usage_all_zero():
    assert parse_invocation_usage({"content": [{"text": "hi"}]}) == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }


def test_parse_tolerates_garbage_inputs():
    zero = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    assert parse_invocation_usage(None) == zero
    assert parse_invocation_usage("nope") == zero
    assert parse_invocation_usage({"usage": "not-a-dict"}) == zero
    assert parse_invocation_usage({"usage": {"input_tokens": -5, "output_tokens": "x"}}) == zero


# ------------------------------------------------------------------ price reg.
def test_resolve_known_model_rates():
    rates = resolve_model_rates(KNOWN_MODEL)
    assert rates is not None
    assert rates.input_per_million == 3.00
    assert rates.cache_write_5m_per_million == 3.75
    assert rates.cache_write_1h_per_million == 6.00
    assert rates.cache_read_per_million == 0.30
    assert rates.output_per_million == 15.00


def test_resolve_unknown_model_returns_none():
    assert resolve_model_rates(UNKNOWN_MODEL) is None


def test_resolve_predating_effective_date_returns_none():
    assert resolve_model_rates(KNOWN_MODEL, as_of=date(2020, 1, 1)) is None


# ------------------------------------------------------------------- cost calc
def test_cost_observe_baseline_no_savings():
    rates = resolve_model_rates(KNOWN_MODEL)
    cost = estimate_cost(
        {
            "input_tokens": 1_000_000,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
        rates,
    )
    assert cost is not None
    assert cost.actual_usd == 3.0
    assert cost.uncached_equiv_usd == 3.0
    assert cost.savings_usd == 0.0


def test_cost_cache_write_and_read_shows_savings_5m():
    rates = resolve_model_rates(KNOWN_MODEL)
    cost = estimate_cost(
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 1_000_000,
            "cache_read_input_tokens": 1_000_000,
        },
        rates,
        ttl="5m",
    )
    assert cost is not None
    # actual = 3.75 + 0.30 = 4.05 ; uncached = 2M * 3.00 = 6.00
    assert abs(cost.actual_usd - 4.05) < 1e-9
    assert abs(cost.uncached_equiv_usd - 6.0) < 1e-9
    assert abs(cost.savings_usd - 1.95) < 1e-9


def test_cost_1h_write_uses_six_dollar_rate():
    rates = resolve_model_rates(KNOWN_MODEL)
    cost = estimate_cost(
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 1_000_000,
            "cache_read_input_tokens": 0,
        },
        rates,
        ttl="1h",
    )
    assert cost is not None
    assert abs(cost.actual_usd - 6.0) < 1e-9
    assert abs(cost.uncached_equiv_usd - 3.0) < 1e-9


def test_cost_unknown_model_returns_none():
    cost = estimate_cost(
        {
            "input_tokens": 1000,
            "output_tokens": 500,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
        resolve_model_rates(UNKNOWN_MODEL),
    )
    assert cost is None


def test_cost_accepts_invocation_usage_object():
    rates = resolve_model_rates(KNOWN_MODEL)
    cost = estimate_cost(_usage(input_tokens=1_000_000), rates)
    assert cost is not None
    assert cost.actual_usd == 3.0


# ------------------------------------------------------------------- EMF shape
def test_emf_namespace_and_dimensions_only_workload_model():
    event = build_emf_event(
        _usage(input_tokens=1000, output_tokens=200), timestamp_ms=1_700_000_000_000
    )
    md = event["_aws"]["CloudWatchMetrics"][0]
    assert md["Namespace"] == EMF_NAMESPACE
    assert md["Dimensions"] == [["workload", "modelId"]]
    assert event["workload"] == "feedback_primary"
    assert event["modelId"] == KNOWN_MODEL
    assert event["Invocations"] == 1
    assert event["InputTokens"] == 1000
    assert event["OutputTokens"] == 200
    assert event["_aws"]["Timestamp"] == 1_700_000_000_000


def test_emf_includes_cost_for_known_and_omits_for_unknown():
    known = build_emf_event(_usage(input_tokens=1000))
    assert "EstimatedCostUsd" in known
    assert "EstimatedSavingsUsd" in known
    names = [m["Name"] for m in known["_aws"]["CloudWatchMetrics"][0]["Metrics"]]
    for expected in [
        "Invocations",
        "InputTokens",
        "OutputTokens",
        "CacheWriteInputTokens",
        "CacheReadInputTokens",
        "CacheEligibleInvocations",
        "CacheFallbacks",
        "InvocationLatency",
        "EstimatedCostUsd",
        "EstimatedSavingsUsd",
    ]:
        assert expected in names

    unknown = build_emf_event(_usage(modelId=UNKNOWN_MODEL, input_tokens=1000))
    assert "EstimatedCostUsd" not in unknown
    unknown_names = [m["Name"] for m in unknown["_aws"]["CloudWatchMetrics"][0]["Metrics"]]
    assert "EstimatedCostUsd" not in unknown_names


def test_emf_and_log_never_contain_forbidden_identifiers():
    event = build_emf_event(_usage(input_tokens=5), )
    line = build_log_line(_usage(input_tokens=5), request_id="req-abc")
    emf_keys = list(event.keys())
    log_json = json.dumps(line)
    for forbidden in FORBIDDEN_KEYS:
        assert forbidden not in emf_keys
        assert forbidden not in log_json
    assert sorted(event["_aws"]["CloudWatchMetrics"][0]["Dimensions"][0]) == [
        "modelId",
        "workload",
    ]


def test_log_line_keeps_request_id_but_not_as_dimension():
    event = build_emf_event(_usage(), )
    line = build_log_line(_usage(), request_id="req-xyz")
    assert line["requestId"] == "req-xyz"
    assert "requestId" not in event
    assert "requestId" not in event["_aws"]["CloudWatchMetrics"][0]["Dimensions"][0]


def test_emit_telemetry_prints_emf_and_log_lines(capsys):
    emit_telemetry(_usage(input_tokens=10, output_tokens=3), timestamp_ms=1)
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 2
    emf = json.loads(out[0])
    log = json.loads(out[1])
    assert emf["_aws"]["CloudWatchMetrics"][0]["Namespace"] == EMF_NAMESPACE
    assert log["event"] == "bedrock_invocation"
    assert log["input_tokens"] == 10


def test_emit_telemetry_never_raises_on_bad_sink():
    # A sink that raises must not propagate (observe mode must be non-fatal).
    def _boom(_line: str) -> None:
        raise RuntimeError("sink down")

    emit_telemetry(_usage(), sink=_boom)  # should not raise
