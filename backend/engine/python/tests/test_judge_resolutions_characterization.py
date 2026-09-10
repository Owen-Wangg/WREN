"""Characterization tests for ``handler.judge_resolutions_with_llm`` (Task 2).

Locks in the CURRENT pre-caching baseline of the resolution-judge Anthropic
``InvokeModel`` request and its verdict handling (see docs/prompt-cache-plan.md
§4.2, §14 — the judge is initially "observe", not cached). Any later change for
caching must break these deliberately.

Baseline invariants asserted:
  - Body: ``anthropic_version`` = ``bedrock-2023-05-31``, ``max_tokens`` = 2048,
    ``temperature`` = 0, a string ``system`` rubric, and the items JSON embedded
    in the user message.
  - Verdict mapping: resolved -> RESOLVED, partial -> PARTIALLY_RESOLVED,
    anything else (incl. unknown) -> STILL_UNRESOLVED.
  - Items missing from the model reply default to STILL_UNRESOLVED (by omission
    handled upstream; here we assert the parsed map only contains what the model
    returned and the count gap is surfaced as "missing").
  - Empty input returns ``{}`` with ZERO Bedrock calls.
  - Malformed-then-valid JSON retries exactly once (two invoke_model calls).
  - No ``cache_control`` in the serialized body.

No live AWS calls: ``handler.boto3.client`` is monkeypatched. The model id is
supplied via ``config['bedrock_model_id']`` so model resolution never runs.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine.progress_tracker import ResolutionStatus  # noqa: E402


class _FakeBody:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw


class _SequenceBedrockClient:
    """Returns a queued payload per invoke_model call; records each request."""

    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self._payloads = list(payloads)
        self.calls: list[dict[str, Any]] = []

    def invoke_model(self, *, modelId: str, body: str) -> dict[str, Any]:  # noqa: N803
        self.calls.append({"modelId": modelId, "body": body})
        payload = self._payloads[min(len(self.calls) - 1, len(self._payloads) - 1)]
        return {"body": _FakeBody(payload)}


def _install(monkeypatch, payloads: list[dict[str, Any]]) -> _SequenceBedrockClient:
    fake = _SequenceBedrockClient(payloads)

    def _fake_client(service_name: str, *_args: Any, **_kwargs: Any) -> _SequenceBedrockClient:
        assert service_name == "bedrock-runtime"
        return fake

    monkeypatch.setattr(handler.boto3, "client", _fake_client)
    return fake


_CONFIG = {"bedrock_model_id": "anthropic.claude-sonnet-4-6"}


def _verdict_payload(verdicts: list[dict[str, str]]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(verdicts)}]}


def _items(*ids: str) -> list[dict[str, Any]]:
    return [
        {
            "id": item_id,
            "question_text": f"Did the student address item {item_id}?",
            "original_text": f"original {item_id}",
            "region_text": f"revised {item_id}",
        }
        for item_id in ids
    ]


def test_judge_body_baseline_fields(monkeypatch):
    fake = _install(monkeypatch, [_verdict_payload([{"id": "a", "verdict": "resolved"}])])

    handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    body = json.loads(fake.calls[0]["body"])
    assert body["anthropic_version"] == "bedrock-2023-05-31"
    assert body["max_tokens"] == 2048
    assert body["temperature"] == 0
    assert isinstance(body["system"], str) and body["system"].strip()
    # The items JSON is embedded in the (single) user message.
    assert len(body["messages"]) == 1
    assert body["messages"][0]["role"] == "user"
    user_text = body["messages"][0]["content"]
    assert '"feedback_question"' in user_text
    assert '"revised_text": "revised a"' in user_text


def test_verdict_mapping_covers_resolved_partial_and_fallback(monkeypatch):
    _install(
        monkeypatch,
        [
            _verdict_payload(
                [
                    {"id": "r", "verdict": "resolved"},
                    {"id": "p", "verdict": "partial"},
                    {"id": "u", "verdict": "unresolved"},
                    {"id": "x", "verdict": "something-unknown"},
                ]
            )
        ],
    )

    result = handler.judge_resolutions_with_llm(_items("r", "p", "u", "x"), _CONFIG)

    assert result["r"] is ResolutionStatus.RESOLVED
    assert result["p"] is ResolutionStatus.PARTIALLY_RESOLVED
    assert result["u"] is ResolutionStatus.STILL_UNRESOLVED
    # Unknown verdicts fall through to STILL_UNRESOLVED (safe default).
    assert result["x"] is ResolutionStatus.STILL_UNRESOLVED


def test_missing_items_are_absent_from_map_and_default_upstream(monkeypatch):
    # Two items sent, model only returns a verdict for one.
    _install(monkeypatch, [_verdict_payload([{"id": "a", "verdict": "resolved"}])])

    result = handler.judge_resolutions_with_llm(_items("a", "b"), _CONFIG)

    assert result == {"a": ResolutionStatus.RESOLVED}
    # "b" is missing from the reply; callers treat missing verdicts as
    # STILL_UNRESOLVED (handler applies that default when applying updates).
    assert "b" not in result


def test_empty_input_returns_empty_map_with_zero_calls(monkeypatch):
    fake = _install(monkeypatch, [_verdict_payload([])])

    result = handler.judge_resolutions_with_llm([], _CONFIG)

    assert result == {}
    assert fake.calls == []


def test_malformed_then_valid_json_retries_exactly_once(monkeypatch):
    fake = _install(
        monkeypatch,
        [
            {"content": [{"type": "text", "text": "this is not json {{{"}]},
            _verdict_payload([{"id": "a", "verdict": "partial"}]),
        ],
    )

    result = handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    # Exactly two invoke_model calls: one failure + one retry that succeeds.
    assert len(fake.calls) == 2
    assert result == {"a": ResolutionStatus.PARTIALLY_RESOLVED}


def test_serialized_body_contains_no_cache_control(monkeypatch):
    fake = _install(monkeypatch, [_verdict_payload([{"id": "a", "verdict": "resolved"}])])

    handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    assert "cache_control" not in fake.calls[0]["body"]


# --------------------------------------------------------------------------- #
# Telemetry parity (prompt-cache plan Task 8, §3/§14/§16)                       #
#                                                                              #
# The resolution judge builds its OWN Anthropic body (not via invoke_bedrock), #
# so these tests lock in that it STILL emits the same normalized observe-mode  #
# telemetry (workload='resolution_judge') on the success path and on the       #
# failure path — WITHOUT changing the body, verdict mapping, or the            #
# two-attempt retry semantics asserted above.                                  #
# --------------------------------------------------------------------------- #


class _RaisingBedrockClient:
    """invoke_model raises a fixed exception on every call; records calls."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc
        self.calls: list[dict[str, Any]] = []

    def invoke_model(self, *, modelId: str, body: str) -> dict[str, Any]:  # noqa: N803
        self.calls.append({"modelId": modelId, "body": body})
        raise self._exc


def _install_raising(monkeypatch, exc: Exception) -> _RaisingBedrockClient:
    fake = _RaisingBedrockClient(exc)

    def _fake_client(service_name: str, *_args: Any, **_kwargs: Any) -> _RaisingBedrockClient:
        assert service_name == "bedrock-runtime"
        return fake

    monkeypatch.setattr(handler.boto3, "client", _fake_client)
    return fake


def _capture_telemetry(monkeypatch) -> list[dict[str, Any]]:
    """Patch handler.emit_telemetry to record (usage, kwargs) tuples."""
    captured: list[dict[str, Any]] = []

    def _fake_emit(usage, **kwargs):
        captured.append({"usage": usage, "kwargs": kwargs})

    monkeypatch.setattr(handler, "emit_telemetry", _fake_emit)
    return captured


def test_judge_emits_success_telemetry_with_resolution_judge_workload(monkeypatch):
    _install(monkeypatch, [_verdict_payload([{"id": "a", "verdict": "resolved"}])])
    captured = _capture_telemetry(monkeypatch)

    result = handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    # Verdict mapping unchanged.
    assert result == {"a": ResolutionStatus.RESOLVED}
    # Exactly one telemetry emission, labelled resolution_judge, success=True,
    # with the full normalized shape (token fields default to 0 when absent).
    assert len(captured) == 1
    usage = captured[0]["usage"]
    assert usage.workload == "resolution_judge"
    assert usage.success is True
    assert usage.modelId  # a concrete model id was resolved from config
    assert usage.input_tokens == 0
    assert usage.output_tokens == 0
    assert usage.cache_creation_input_tokens == 0
    assert usage.cache_read_input_tokens == 0
    assert isinstance(usage.latencyMs, float)


def test_judge_success_telemetry_normalizes_usage_block(monkeypatch):
    payload = {
        "content": [{"type": "text", "text": json.dumps([{"id": "a", "verdict": "partial"}])}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 321, "output_tokens": 40},
    }
    _install(monkeypatch, [payload])
    captured = _capture_telemetry(monkeypatch)

    handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    usage = captured[0]["usage"]
    assert usage.workload == "resolution_judge"
    assert usage.success is True
    assert usage.input_tokens == 321
    assert usage.output_tokens == 40
    # No caching activity in observe mode → cache token fields stay 0.
    assert usage.cache_creation_input_tokens == 0
    assert usage.cache_read_input_tokens == 0
    assert usage.stopReason == "end_turn"


def test_judge_retry_path_emits_success_telemetry_per_decoded_response(monkeypatch):
    # First response is malformed JSON (decodes to a dict but verdict parse
    # fails), second is valid → two invoke_model calls, telemetry emitted for
    # BOTH decoded responses with success=True. Retry semantics unchanged.
    fake = _install(
        monkeypatch,
        [
            {"content": [{"type": "text", "text": "this is not json {{{"}]},
            _verdict_payload([{"id": "a", "verdict": "partial"}]),
        ],
    )
    captured = _capture_telemetry(monkeypatch)

    result = handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    assert len(fake.calls) == 2  # retry happened exactly once
    assert result == {"a": ResolutionStatus.PARTIALLY_RESOLVED}
    # Telemetry emitted for each decoded response; all labelled resolution_judge.
    assert len(captured) == 2
    for entry in captured:
        assert entry["usage"].workload == "resolution_judge"
        assert entry["usage"].success is True


def test_judge_failure_path_emits_failure_telemetry(monkeypatch):
    # A NON-JSONDecodeError (e.g. a Bedrock/client error) triggers the generic
    # except branch, which retries once and then defaults to {}. Telemetry is
    # emitted with success=False and the fallbackReason on each attempt.
    fake = _install_raising(monkeypatch, RuntimeError("bedrock unavailable"))
    captured = _capture_telemetry(monkeypatch)

    result = handler.judge_resolutions_with_llm(_items("a", "b"), _CONFIG)

    # Two attempts (retry-once), both raise → default to empty map (callers then
    # treat missing verdicts as STILL_UNRESOLVED). Behavior unchanged.
    assert result == {}
    assert len(fake.calls) == 2
    # Failure telemetry emitted for each failed attempt.
    assert len(captured) == 2
    for entry in captured:
        usage = entry["usage"]
        assert usage.workload == "resolution_judge"
        assert usage.success is False
        assert usage.fallbackReason == "RuntimeError"
        # No usage tokens on a failed call.
        assert usage.input_tokens == 0
        assert usage.output_tokens == 0


def test_judge_failure_telemetry_does_not_change_body_or_add_cache_control(monkeypatch):
    fake = _install_raising(monkeypatch, RuntimeError("bedrock unavailable"))
    _capture_telemetry(monkeypatch)

    handler.judge_resolutions_with_llm(_items("a"), _CONFIG)

    # Even on the failure path, the serialized body is the baseline body with no
    # cache markers (telemetry is additive only).
    body = json.loads(fake.calls[0]["body"])
    assert body["anthropic_version"] == "bedrock-2023-05-31"
    assert body["max_tokens"] == 2048
    assert body["temperature"] == 0
    assert "cache_control" not in fake.calls[0]["body"]
