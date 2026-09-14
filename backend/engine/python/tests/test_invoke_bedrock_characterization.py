"""Characterization tests for ``handler.invoke_bedrock`` (prompt-cache plan Task 2).

These lock in the CURRENT pre-caching baseline of the Anthropic ``InvokeModel``
request the Feedback Engine sends (see docs/prompt-cache-plan.md §4.2) so that a
later prompt restructuring for explicit caching (§12.2 / §17) is a deliberate,
reviewable change and not an accident.

Baseline invariants asserted:
  - Body carries ``anthropic_version`` = ``bedrock-2023-05-31``.
  - ``max_tokens`` equals the value passed to ``invoke_bedrock``.
  - ``temperature`` comes from ``config`` (default 0.4).
  - The ``"system\\n\\n---\\n\\nuser"`` sentinel is split into ``system`` +
    a single user message.
  - Returns ``(text, stop_reason)`` from ``content[0].text`` / ``stop_reason``.
  - No ``cache_control`` appears anywhere in the serialized body today.

No live AWS calls: ``handler.boto3.client`` is monkeypatched with a fake whose
``invoke_model`` captures the request body and returns a canned Anthropic
response. The model id is supplied via ``config['bedrock_model_id']`` so
``resolve_bedrock_model_id`` (env/SSM) is never exercised.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

# The engine's conftest.py adds the python root to sys.path; keep this defensive
# insert to mirror the sibling handler tests (test_prompt_assembly_footnotes.py).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402


class _FakeBody:
    """Minimal stand-in for the streaming body returned by invoke_model."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw


class _FakeBedrockClient:
    """Records the invoke_model request and returns a canned Anthropic reply."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.calls: list[dict[str, Any]] = []

    def invoke_model(self, *, modelId: str, body: str) -> dict[str, Any]:  # noqa: N803
        self.calls.append({"modelId": modelId, "body": body})
        return {"body": _FakeBody(self._payload)}


def _install_fake_client(monkeypatch, payload: dict[str, Any]) -> _FakeBedrockClient:
    """Patch handler.boto3.client so every service request returns the fake."""
    fake = _FakeBedrockClient(payload)

    def _fake_client(service_name: str, **_kwargs: Any) -> _FakeBedrockClient:
        assert service_name == "bedrock-runtime"
        return fake

    monkeypatch.setattr(handler.boto3, "client", _fake_client)
    return fake


_CONFIG = {"bedrock_model_id": "anthropic.claude-sonnet-4-6", "temperature": 0.4}
_PROMPT = "SYSTEM INSTRUCTIONS\n\n---\n\nUSER DRAFT AND QUESTION"


def _canned_reply(text: str = "A coaching question.", stop_reason: str = "end_turn") -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "stop_reason": stop_reason}


def test_body_carries_baseline_anthropic_version(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=1024)

    body = json.loads(fake.calls[0]["body"])
    assert body["anthropic_version"] == "bedrock-2023-05-31"


def test_max_tokens_equals_passed_value(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=777)

    body = json.loads(fake.calls[0]["body"])
    assert body["max_tokens"] == 777


def test_temperature_comes_from_config(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock(_PROMPT, {"bedrock_model_id": "anthropic.claude-sonnet-4-6", "temperature": 0.9}, max_tokens=256)

    body = json.loads(fake.calls[0]["body"])
    assert body["temperature"] == 0.9


def test_temperature_defaults_to_point_four_when_absent(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock(_PROMPT, {"bedrock_model_id": "anthropic.claude-sonnet-4-6"}, max_tokens=256)

    body = json.loads(fake.calls[0]["body"])
    assert body["temperature"] == 0.4


def test_sentinel_splits_into_system_and_single_user_message(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256)

    body = json.loads(fake.calls[0]["body"])
    assert body["system"] == "SYSTEM INSTRUCTIONS"
    assert body["messages"] == [{"role": "user", "content": "USER DRAFT AND QUESTION"}]


def test_returns_text_and_stop_reason_tuple(monkeypatch):
    _install_fake_client(monkeypatch, _canned_reply(text="Consider the counterargument.", stop_reason="max_tokens"))

    text, stop_reason = handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256)

    assert text == "Consider the counterargument."
    assert stop_reason == "max_tokens"


def test_serialized_body_contains_no_cache_control(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock(_PROMPT, _CONFIG, max_tokens=256)

    # Baseline: no explicit caching markers anywhere in today's request.
    assert "cache_control" not in fake.calls[0]["body"]


def test_prompt_without_sentinel_sends_only_a_user_message(monkeypatch):
    fake = _install_fake_client(monkeypatch, _canned_reply())

    handler.invoke_bedrock("plain single-turn prompt", _CONFIG, max_tokens=256)

    body = json.loads(fake.calls[0]["body"])
    assert "system" not in body
    assert body["messages"] == [{"role": "user", "content": "plain single-turn prompt"}]
