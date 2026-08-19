"""Model-agnostic Bedrock invocation for the WREN Feedback Engine (Task 9.3).

Invokes the configured Bedrock model through ``langchain-aws``'s
``ChatBedrockConverse`` (the model-agnostic Bedrock Converse API abstraction)
so that changing the configured model identifier requires configuration only,
never a code change (REQ-NFR-MODEL-01 / Requirement 51).

The model id is resolved at runtime — never hardcoded — mirroring the CDK
single-source config convention (``cdk/lib/config.ts``
``bedrockModelIdParameterName``: SSM path ``/${stackPrefix}/config/bedrock-model-id``)
and the ``wren_db`` credential-resolution pattern (``wren_db.secrets``,
``wren_db.pool``): a non-secret Lambda environment variable is checked first
(populated from SSM at deploy/cold-start per the UBC CIC Lambda steering), with
a lazy-imported, injectable SSM client as a fallback for environments where the
env var was not populated.

Design references:
  - design.md "Feedback Engine (Python 3.12, container Lambda)": "Model
    invocation: via `langchain-aws` against a configured Bedrock model id
    (Claude Sonnet/Haiku). No model id is hardcoded; changing it is
    configuration only."
  - requirements.md Requirement 51 (REQ-NFR-MODEL-01) criteria 51.1-51.3.
  - cdk/lib/config.ts ``DEFAULT_BEDROCK_MODEL_ID`` / ``bedrockModelIdParameterName``.

Unlike ``prompt_assembly.py`` (pure logic), this module's boundary IS the
non-deterministic model call, so it follows the same injection pattern as
``SpanJudge`` in ``progress_tracker.py``: :class:`ModelInvoker` is a
``Protocol`` that production code satisfies with :class:`LangChainBedrockInvoker`
and tests satisfy with a stub — no real AWS/model call is required to test the
Feedback Engine's orchestration logic.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Protocol, runtime_checkable

from .prompt_assembly import AssembledPrompt

__all__ = [
    "ModelInvocationError",
    "ModelReply",
    "ModelInvoker",
    "LangChainBedrockInvoker",
    "resolve_bedrock_model_id",
    "to_cross_region_inference_profile_id",
    "bedrock_model_id_parameter_name",
]

#: Non-secret Lambda environment variable carrying the Bedrock model id.
#: Used as a local/test fallback when ``STACK_PREFIX`` is unset so a live SSM
#: read is not required.
_MODEL_ID_ENV_VAR = "BEDROCK_MODEL_ID"

#: Environment variable carrying the deployment's ``StackPrefix``. When set,
#: the model id is read from SSM (``/${stackPrefix}/config/bedrock-model-id``)
#: so Admin UI updates take effect without a Lambda redeploy.
_STACK_PREFIX_ENV_VAR = "STACK_PREFIX"


class ModelInvocationError(RuntimeError):
    """Raised when the configured model cannot be resolved or invoked."""


def bedrock_model_id_parameter_name(stack_prefix: str) -> str:
    """Build the SSM parameter path for the Bedrock model id.

    Mirrors ``cdk/lib/config.ts`` ``bedrockModelIdParameterName``:
    ``/${stackPrefix}/config/bedrock-model-id``. Kept as a pure function (no
    I/O) so the path convention is independently testable and stays in sync
    with the TypeScript side without a live SSM call.
    """
    if not stack_prefix:
        raise ValueError("stack_prefix must not be empty")
    return f"/{stack_prefix}/config/bedrock-model-id"


def to_cross_region_inference_profile_id(model_id: str) -> str:
    """Map a bare Anthropic/Meta foundation-model id to a US CRIS profile.

    IAM on Compute only allows ``us.anthropic.*`` / ``us.meta.*`` inference
    profiles. A stored ``anthropic.claude-…`` id would invoke the regional
    foundation-model ARN and 403.
    """
    value = model_id.strip()
    if value.startswith(("us.", "eu.", "apac.")):
        return value
    if value.startswith(("anthropic.", "meta.")):
        return f"us.{value}"
    return value


def resolve_bedrock_model_id(
    *,
    env: Optional[Mapping[str, str]] = None,
    ssm_client: Optional[Any] = None,
) -> str:
    """Resolve the configured Bedrock model id — never a hardcoded literal.

    Resolution order (REQ-NFR-MODEL-01 criteria 51.2, 51.3 — no model id is
    hardcoded as the only supported model; changing the configured id requires
    no orchestration-logic change):

    1. A live SSM ``GetParameter`` call against
       :func:`bedrock_model_id_parameter_name` when ``STACK_PREFIX`` is set.
       This is the production source of truth so the Admin model-config UI
       can change the id without a Lambda redeploy.
    2. ``BEDROCK_MODEL_ID`` environment variable — local/test fallback when
       SSM is not configured. ``ssm_client`` is injectable so tests need no
       live AWS call; production lazily imports ``boto3``.

    Raises :class:`ModelInvocationError` if neither source yields a value —
    the engine must never silently fall back to an in-code default model id.
    """
    env = env if env is not None else os.environ

    stack_prefix = env.get(_STACK_PREFIX_ENV_VAR)
    if stack_prefix and stack_prefix.strip():
        if ssm_client is None:
            import boto3  # Lazy import: boto3 is provided by the Lambda runtime.

            ssm_client = boto3.client("ssm")

        parameter_name = bedrock_model_id_parameter_name(stack_prefix.strip())
        try:
            response = ssm_client.get_parameter(Name=parameter_name)
        except Exception as exc:  # noqa: BLE001 - re-raised as a typed error below.
            raise ModelInvocationError(
                f"Failed to read SSM parameter {parameter_name!r}: {exc}"
            ) from exc

        value = response.get("Parameter", {}).get("Value")
        if not value or not value.strip():
            raise ModelInvocationError(
                f"SSM parameter {parameter_name!r} is empty or missing a Value."
            )
        return to_cross_region_inference_profile_id(value.strip())

    from_env = env.get(_MODEL_ID_ENV_VAR)
    if from_env and from_env.strip():
        return to_cross_region_inference_profile_id(from_env.strip())

    raise ModelInvocationError(
        f"Cannot resolve the Bedrock model id: neither {_MODEL_ID_ENV_VAR!r} "
        f"nor {_STACK_PREFIX_ENV_VAR!r} is set in the environment."
    )


@dataclass(frozen=True, slots=True)
class ModelReply:
    """The model's raw text reply to an :class:`AssembledPrompt`.

    Deliberately minimal: parsing/validating structured output (the
    ``{category, question, anchor?, citation?}`` schema and the no-ghostwriting
    output guardrail) is Task 9.4's concern, not this module's. This module's
    only job is model-agnostic invocation.
    """

    text: str


@runtime_checkable
class ModelInvoker(Protocol):
    """Injected model-invocation boundary (Requirement 51 / REQ-NFR-MODEL-01).

    A callable that sends an :class:`AssembledPrompt` (system message + user
    message, from ``prompt_assembly.py``) to the configured model and returns
    its raw reply. Injecting this Protocol keeps Feedback Engine orchestration
    logic testable without invoking Bedrock, exactly as :class:`SpanJudge`
    keeps the Progress Tracker testable without invoking a real model.
    """

    def invoke(self, prompt: AssembledPrompt) -> ModelReply: ...


class LangChainBedrockInvoker:
    """Production :class:`ModelInvoker` — Bedrock via ``langchain-aws``.

    Uses ``ChatBedrockConverse`` (the modern Bedrock Converse API integration),
    which is model-agnostic: it accepts any Bedrock ``model_id`` string, so
    swapping models (e.g. Claude Sonnet -> Claude Haiku) is a configuration
    change only (REQ-NFR-MODEL-01 criteria 51.1, 51.2). No model id is
    hardcoded here; it is always supplied by the caller (typically via
    :func:`resolve_bedrock_model_id`) or resolved lazily on first use.

    ``langchain-aws`` is imported lazily so this module — and the rest of
    ``wren_engine`` — remains importable in environments (e.g. the pure-logic
    engine core's test suite) where the container-Lambda-only dependency is
    not installed.
    """

    def __init__(
        self,
        model_id: Optional[str] = None,
        *,
        region_name: Optional[str] = None,
        client: Optional[Any] = None,
        env: Optional[Mapping[str, str]] = None,
        **model_kwargs: Any,
    ) -> None:
        """Construct an invoker bound to a model id.

        ``model_id`` may be omitted, in which case it is resolved lazily (on
        first :meth:`invoke`) via :func:`resolve_bedrock_model_id` so
        constructing this object never requires AWS access. ``client`` allows
        injecting a pre-built ``ChatBedrockConverse`` (or compatible) instance
        for tests; ``model_kwargs`` are forwarded to ``ChatBedrockConverse``
        (e.g. ``temperature``, ``max_tokens``) for callers that need them.
        """
        self._model_id = model_id
        self._region_name = region_name
        self._client = client
        self._env = env
        self._model_kwargs = model_kwargs
        self._chat: Optional[Any] = client

    def _resolve_chat(self) -> Any:
        if self._chat is not None:
            return self._chat

        model_id = self._model_id or resolve_bedrock_model_id(env=self._env)

        from langchain_aws import ChatBedrockConverse  # Lazy: container-Lambda-only dep.

        self._chat = ChatBedrockConverse(
            model_id=model_id,
            region_name=self._region_name,
            **self._model_kwargs,
        )
        return self._chat

    def invoke(self, prompt: AssembledPrompt) -> ModelReply:
        """Invoke the configured model with the assembled system/user layers.

        The system message (authoritative, non-overridable per
        ``prompt_assembly.py``) and the user message (Document-Type layer +
        delimited untrusted data) are passed through as separate LangChain
        messages so the underlying Bedrock Converse API keeps the same
        system/user separation the prompt assembly relies on.
        """
        chat = self._resolve_chat()

        from langchain_core.messages import HumanMessage, SystemMessage  # Lazy.

        messages = [
            SystemMessage(content=prompt.system_message),
            HumanMessage(content=prompt.user_message),
        ]
        result = chat.invoke(messages)
        content = getattr(result, "content", result)
        if not isinstance(content, str):
            content = str(content)
        return ModelReply(text=content)
