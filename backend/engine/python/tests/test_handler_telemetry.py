"""Handler telemetry wiring tests (prompt-cache plan Task 3, OBSERVE mode).

Assert that instrumenting ``handler.invoke_bedrock`` and
``handler.judge_resolutions_with_llm`` with telemetry:
  - Leaves return values unchanged (text/stop_reason tuple; verdict map).
  - Leaves retry behavior unchanged (malformed-then-valid → exactly one retry).
  - Emits an EMF event + structured log line to stdout (captured via capsys) with
    the correct workload label, only workload+modelId dimensions, and no student
    identifiers or prompt text.
  - Adds NO ``cache_control`` to the serialized request body.

No live AWS: ``handler.boto3.client`` is monkeypatched.
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


class _FakeBedrockClient:
    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self._payloads = list(payloads)
        self.calls: list[dict[str, Any]] = []

    def invoke_model(self, *, modelId: str, body: str) -> dict[str, Any]:  # noqa: N803
        self.calls.append({"modelId": modelId, "body": body})
        payload = self._payloads[min(len(self.calls) - 1, len(self._payloads) - 1)]
        return {
            "body": _FakeBody(payload),
            "ResponseMetadata": {"RequestId": "req-fake-123"},
        }


def _install(monkeypatch, payloads: list[dict[str, Any]]) -> _FakeBedrockClient:
    fake = _FakeBedrockClient(payloads)

    def _fake_client(service_name: str, *_args: Any, **_kwargs: Any) -> _FakeBedrockClient:
        assert service_name == "bedrock-runtime"
        return fake

    monkeypatch.setattr(handler.boto3, "client", _fake_client)
    return fake


_CONFIG = {"bedrock_model_id": "anthropic.claude-sonnet-4-6", "temperature": 0.4}
_PROMPT = "SYSTEM INSTRUCTIONS\n\n---\n\nUSER DRAFT AND QUESTION"

FORBIDDEN = ["userId", "documentId", "draftId", "departmentId", "jobId"]


def _reply(text: str = "A coaching question.", stop_reason: str = "end_turn", usage=None) -> dict[str, Any]:
    payload: dict[str, Any] = {"content": [{"type": "text", "text": text}], "stop_reason": stop_reason}
    if usage is not None:
        payload["usage"] = usage
    return payload


def _emf_and_log(capsys):
    lines = [l for l in capsys.readouterr().out.strip().splitlines() if l.strip()]
    emf = next(json.loads(l) for l in lines if "CloudWatchMetrics" in l)
    log = next(json.loads(l) for l in lines if "bedrock_invocation" in l)
    return emf, log, lines


# --------------------------------------------------------------- invoke_bedrock
def test_invoke_bedrock_return_value_unchanged(monkeypatch):
    _install(monkeypatch, [_reply(text="Consider the counterargument.", stop_reason="max_tokens")])
    text, stop_reason = handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256)
    assert text == "Consider the counterargument."
    assert stop_reason == "max_tokens"


def test_invoke_bedrock_emits_telemetry_with_workload_and_usage(monkeypatch, capsys):
    _install(
        monkeypatch,
        [_reply(usage={"input_tokens": 2048, "output_tokens": 128})],
    )
    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256, workload="feedback_primary")

    emf, log, lines = _emf_and_log(capsys)
    assert emf["_aws"]["CloudWatchMetrics"][0]["Namespace"] == "WREN/Bedrock"
    assert emf["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["workload", "modelId"]]
    assert emf["workload"] == "feedback_primary"
    # model id is normalized to the us.* cross-region profile.
    assert emf["modelId"] == "us.anthropic.claude-sonnet-4-6"
    assert emf["InputTokens"] == 2048
    assert emf["OutputTokens"] == 128
    assert emf["EstimatedCostUsd"] > 0
    assert log["requestId"] == "req-fake-123"
    # Privacy: no prompt text or identifiers in telemetry.
    for line in lines:
        assert "USER DRAFT AND QUESTION" not in line
        for forbidden in FORBIDDEN:
            assert forbidden not in line


def test_invoke_bedrock_default_workload_when_omitted(monkeypatch, capsys):
    _install(monkeypatch, [_reply(usage={"input_tokens": 10})])
    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256)
    emf, _log, _lines = _emf_and_log(capsys)
    assert emf["workload"] == "feedback_primary"


def test_invoke_bedrock_body_has_no_cache_control(monkeypatch):
    fake = _install(monkeypatch, [_reply()])
    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256, workload="quote_fill")
    assert "cache_control" not in fake.calls[0]["body"]


def test_invoke_bedrock_error_reraised_and_failure_telemetry(monkeypatch, capsys):
    class _Boom:
        def invoke_model(self, **_kwargs):
            raise RuntimeError("bedrock unavailable")

    monkeypatch.setattr(handler.boto3, "client", lambda *a, **k: _Boom())

    import pytest

    with pytest.raises(RuntimeError):
        handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256, workload="strength_fill")

    lines = [l for l in capsys.readouterr().out.strip().splitlines() if l.strip()]
    log = next(json.loads(l) for l in lines if "bedrock_invocation" in l)
    assert log["success"] is False
    assert log["workload"] == "strength_fill"
    assert log["fallbackReason"] == "RuntimeError"


# --------------------------------------------------------- judge_resolutions
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


def _verdict_payload(verdicts, usage=None) -> dict[str, Any]:
    payload: dict[str, Any] = {"content": [{"type": "text", "text": json.dumps(verdicts)}]}
    if usage is not None:
        payload["usage"] = usage
    return payload


def test_judge_return_value_unchanged_and_emits_resolution_judge(monkeypatch, capsys):
    _install(
        monkeypatch,
        [
            _verdict_payload(
                [
                    {"id": "r", "verdict": "resolved"},
                    {"id": "p", "verdict": "partial"},
                    {"id": "u", "verdict": "unresolved"},
                ],
                usage={"input_tokens": 900, "output_tokens": 40},
            )
        ],
    )
    result = handler.judge_resolutions_with_llm(_items("r", "p", "u"), _CONFIG)
    assert result["r"] is ResolutionStatus.RESOLVED
    assert result["p"] is ResolutionStatus.PARTIALLY_RESOLVED
    assert result["u"] is ResolutionStatus.STILL_UNRESOLVED

    emf, log, _lines = _emf_and_log(capsys)
    assert emf["workload"] == "resolution_judge"
    assert emf["InputTokens"] == 900
    assert log["workload"] == "resolution_judge"


def test_judge_empty_input_emits_nothing(monkeypatch, capsys):
    fake = _install(monkeypatch, [_verdict_payload([])])
    result = handler.judge_resolutions_with_llm([], _CONFIG)
    assert result == {}
    assert fake.calls == []
    assert capsys.readouterr().out.strip() == ""


def test_judge_malformed_then_valid_retries_exactly_once(monkeypatch, capsys):
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
    # Two successful envelope decodes → two EMF events emitted.
    emf_lines = [
        l for l in capsys.readouterr().out.splitlines() if "CloudWatchMetrics" in l
    ]
    assert len(emf_lines) == 2


def test_judge_body_has_no_cache_control(monkeypatch):
    fake = _install(monkeypatch, [_verdict_payload([{"id": "a", "verdict": "resolved"}])])
    handler.judge_resolutions_with_llm(_items("a"), _CONFIG)
    assert "cache_control" not in fake.calls[0]["body"]
