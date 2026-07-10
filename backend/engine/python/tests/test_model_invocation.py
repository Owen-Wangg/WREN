"""Example-based unit tests for model-agnostic Bedrock invocation (Task 9.3).

Covers model-id resolution (env var first, then SSM fallback, never a
hardcoded default — Requirement 51 / REQ-NFR-MODEL-01 criteria 51.2, 51.3) and
:class:`LangChainBedrockInvoker` invocation using an injected fake chat client
so no real AWS or Bedrock call is made.
"""
from __future__ import annotations

from typing import Any

import pytest

from wren_engine import (
    LangChainBedrockInvoker,
    ModelInvocationError,
    bedrock_model_id_parameter_name,
    resolve_bedrock_model_id,
)
from wren_engine.model_invocation import ModelReply
from wren_engine.prompt_assembly import AssembledPrompt


# --------------------------------------------------------------------------- #
# bedrock_model_id_parameter_name — mirrors cdk/lib/config.ts                  #
# --------------------------------------------------------------------------- #


def test_parameter_name_mirrors_cdk_convention():
    assert (
        bedrock_model_id_parameter_name("wren-dev")
        == "/wren-dev/config/bedrock-model-id"
    )


def test_parameter_name_rejects_empty_prefix():
    with pytest.raises(ValueError):
        bedrock_model_id_parameter_name("")


# --------------------------------------------------------------------------- #
# resolve_bedrock_model_id — Requirement 51.2, 51.3: no hardcoded model id     #
# --------------------------------------------------------------------------- #


def test_resolve_from_env_var_takes_precedence():
    env = {
        "BEDROCK_MODEL_ID": "anthropic.claude-3-5-haiku-20241022-v1:0",
        "STACK_PREFIX": "wren-dev",
    }
    assert (
        resolve_bedrock_model_id(env=env)
        == "anthropic.claude-3-5-haiku-20241022-v1:0"
    )


def test_resolve_strips_whitespace_from_env_var():
    env = {"BEDROCK_MODEL_ID": "  anthropic.claude-3-5-sonnet-20241022-v2:0  \n"}
    assert (
        resolve_bedrock_model_id(env=env)
        == "anthropic.claude-3-5-sonnet-20241022-v2:0"
    )


def test_resolve_falls_back_to_ssm_when_env_var_absent():
    class FakeSsmClient:
        def __init__(self) -> None:
            self.requested_names: list[str] = []

        def get_parameter(self, Name: str) -> dict:  # noqa: N803 - mirrors boto3 API
            self.requested_names.append(Name)
            return {"Parameter": {"Value": "anthropic.claude-3-5-sonnet-20241022-v2:0"}}

    fake_client = FakeSsmClient()
    env = {"STACK_PREFIX": "wren-prod"}

    model_id = resolve_bedrock_model_id(env=env, ssm_client=fake_client)

    assert model_id == "anthropic.claude-3-5-sonnet-20241022-v2:0"
    assert fake_client.requested_names == ["/wren-prod/config/bedrock-model-id"]


def test_resolve_raises_when_neither_env_var_nor_stack_prefix_present():
    with pytest.raises(ModelInvocationError):
        resolve_bedrock_model_id(env={})


def test_resolve_raises_when_ssm_parameter_value_is_empty():
    class EmptyValueSsmClient:
        def get_parameter(self, Name: str) -> dict:  # noqa: N803
            return {"Parameter": {"Value": "   "}}

    with pytest.raises(ModelInvocationError):
        resolve_bedrock_model_id(
            env={"STACK_PREFIX": "wren-dev"}, ssm_client=EmptyValueSsmClient()
        )


def test_resolve_never_returns_a_literal_default_when_unconfigured():
    """No source of truth configured => error, never a silent hardcoded model id."""
    with pytest.raises(ModelInvocationError):
        resolve_bedrock_model_id(env={"SOME_OTHER_VAR": "x"})


# --------------------------------------------------------------------------- #
# LangChainBedrockInvoker — model-agnostic invocation (Requirement 51.1)      #
# --------------------------------------------------------------------------- #


class _FakeChatResult:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChatModel:
    """Stands in for ``ChatBedrockConverse`` without any real Bedrock call."""

    def __init__(self, reply_text: str = "Have you considered the counterargument?") -> None:
        self.reply_text = reply_text
        self.invocations: list[list[Any]] = []

    def invoke(self, messages: list[Any]) -> _FakeChatResult:
        self.invocations.append(messages)
        return _FakeChatResult(self.reply_text)


def _prompt() -> AssembledPrompt:
    return AssembledPrompt(
        system_message="SYSTEM: never rewrite the text.",
        user_message="USER: please review this paragraph.",
        boundary_token="abc123",
    )


def test_invoke_uses_injected_client_and_returns_model_reply():
    fake_chat = _FakeChatModel(reply_text="Consider narrowing your thesis.")
    invoker = LangChainBedrockInvoker(model_id="anthropic.claude-3-5-sonnet-20241022-v2:0", client=fake_chat)

    reply = invoker.invoke(_prompt())

    assert isinstance(reply, ModelReply)
    assert reply.text == "Consider narrowing your thesis."
    assert len(fake_chat.invocations) == 1


def test_invoke_passes_system_and_user_messages_separately():
    fake_chat = _FakeChatModel()
    invoker = LangChainBedrockInvoker(model_id="anthropic.claude-3-5-sonnet-20241022-v2:0", client=fake_chat)
    prompt = _prompt()

    invoker.invoke(prompt)

    [messages] = fake_chat.invocations
    assert len(messages) == 2
    system_message, human_message = messages
    assert system_message.content == prompt.system_message
    assert human_message.content == prompt.user_message


def test_invoke_coerces_non_string_content_to_string():
    fake_chat = _FakeChatModel()
    fake_chat.reply_text = None  # type: ignore[assignment]

    class _NonStringResult:
        content = 12345

    fake_chat.invoke = lambda messages: _NonStringResult()  # type: ignore[assignment]
    invoker = LangChainBedrockInvoker(model_id="anthropic.claude-3-5-sonnet-20241022-v2:0", client=fake_chat)

    reply = invoker.invoke(_prompt())

    assert reply.text == "12345"


def test_constructing_invoker_without_model_id_requires_no_aws_access():
    """Model id resolution is deferred to first invoke(), never at construction."""
    invoker = LangChainBedrockInvoker()
    assert invoker is not None  # No exception: no AWS/SSM/model call happened yet.


def test_invoke_without_explicit_model_id_resolves_lazily_and_raises_when_unconfigured():
    invoker = LangChainBedrockInvoker(env={})
    with pytest.raises(ModelInvocationError):
        invoker.invoke(_prompt())
