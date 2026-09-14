"""Cache capability & policy DECISION LAYER (prompt-cache plan Task 4, §7/§10/§11/§14/§15).

Python mirror of ``backend/feedback/src/cachePolicy.ts`` with identical semantics.

This module is a pure, deterministic decision layer. It DOES NOT build requests,
DOES NOT add ``cache_control`` markers, DOES NOT change prompt text/ordering, and
DOES NOT change model output or error behavior. It only answers two questions per
invocation:

  1. WHETHER explicit caching applies (mode × workload allowlist × model capability).
  2. WHERE the single approved checkpoint may go (which content classes may EVER
     carry a checkpoint — prohibited classes NEVER may).

Task 5+ consumes these decisions to actually construct requests. Until then this
layer emits nothing and touches no live AWS resource.

Default posture (plan §15): ``mode=observe``, ``ttl=5m``, no workloads enabled.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional

__all__ = [
    "CacheMode",
    "CacheTtl",
    "CACHE_WORKLOADS",
    "ModelCacheCapability",
    "normalize_model_key",
    "lookup_model_capability",
    "APPROVED_CONTENT_CLASSES",
    "PROHIBITED_CONTENT_CLASSES",
    "may_content_class_be_cached",
    "CachePolicyConfig",
    "default_cache_policy_config",
    "parse_enabled_workloads",
    "resolve_cache_policy_config",
    "CacheDecision",
    "resolve_cache_decision",
    "CHARS_PER_TOKEN_ESTIMATE",
    "estimate_stable_prefix_tokens",
    "EligibilityDecision",
    "is_explicit_cache_eligible",
    "is_cache_validation_error",
]

# Caching modes (plan §15). ``explicit`` is the only mode that can ever cache.
CacheMode = str  # one of: "off" | "observe" | "explicit"
_MODES = frozenset({"off", "observe", "explicit"})

# Cache write TTL (plan §7/§10). 5-minute first; 1-hour only when data justifies.
CacheTtl = str  # one of: "5m" | "1h"
_TTLS = frozenset({"5m", "1h"})

# Logical workloads (plan §14 strategy matrix). Matches bedrock_telemetry WORKLOADS.
CACHE_WORKLOADS: tuple[str, ...] = (
    "ask_wren",
    "feedback_primary",
    "strength_fill",
    "quote_fill",
    "resolution_judge",
)
_WORKLOAD_SET = frozenset(CACHE_WORKLOADS)


@dataclass(frozen=True)
class ModelCacheCapability:
    """Model caching capability (plan §7).

    Absence of a registry entry => the model is treated as uncached
    (unknown / non-Anthropic models).
    """

    supports_explicit_cache: bool
    min_cache_tokens: int
    max_checkpoints: int
    ttls: tuple[str, ...]
    cache_fields: tuple[str, ...]


def normalize_model_key(model_id: str) -> str:
    """Normalize a Bedrock model id to a capability-registry key.

    Cross-region inference profiles (``us.``/``eu.``/``apac.``) and bare
    foundation-model ids (``anthropic.*``) name the SAME underlying model, so
    they must map to one capability entry. Strips a leading region prefix and
    lower-cases, mirroring the region handling in ``model_invocation.py``.
    A ``:version`` suffix is preserved as part of the key.
    """
    value = (model_id or "").strip().lower()
    if not value:
        return ""
    for prefix in ("us.", "eu.", "apac."):
        if value.startswith(prefix):
            value = value[len(prefix):]
            break
    return value


# Capability registry keyed by NORMALIZED model family/version (plan §7/§15).
# Seeded for Claude Sonnet 4.6. Unknown/non-Anthropic keys are absent =>
# ``lookup_model_capability`` returns None => treated as uncached.
_CAPABILITY_REGISTRY: dict[str, ModelCacheCapability] = {
    "anthropic.claude-sonnet-4-6": ModelCacheCapability(
        supports_explicit_cache=True,
        min_cache_tokens=1024,
        max_checkpoints=4,
        ttls=("5m", "1h"),
        cache_fields=("system", "messages", "tools"),
    ),
}


def lookup_model_capability(model_id: str) -> Optional[ModelCacheCapability]:
    """Look up caching capability for a model id (any region form / bare id).

    Returns ``None`` for unknown or non-Anthropic models (treated as uncached).
    """
    return _CAPABILITY_REGISTRY.get(normalize_model_key(model_id))


# Approved content classes that MAY carry an explicit cache checkpoint (plan §10).
APPROVED_CONTENT_CLASSES: frozenset[str] = frozenset(
    {
        "universal_system",
        "department_context",
        "document_type_config",
        "taxonomy",
        "approved_reference",
    }
)

# Prohibited content classes that must NEVER carry a cache checkpoint (plan §10).
PROHIBITED_CONTENT_CLASSES: frozenset[str] = frozenset(
    {
        "student_draft",
        "student_footnotes",
        "student_question",
        "conversation_history",
        "model_response",
    }
)


def may_content_class_be_cached(content_class: str) -> bool:
    """Whether a content class may EVER carry a cache checkpoint (plan §10).

    Prohibited classes (student content, conversation history, model responses)
    ALWAYS return False. Any unrecognized class also returns False (fail-closed):
    only explicitly approved trusted classes may ever be marked cacheable.
    """
    if content_class in PROHIBITED_CONTENT_CLASSES:
        return False
    return content_class in APPROVED_CONTENT_CLASSES


@dataclass(frozen=True)
class CachePolicyConfig:
    """Per-workload cache policy config (plan §14/§15).

    Resolvable from explicit inputs/env with NO global state so it is fully
    testable.
    """

    mode: str
    ttl: str
    enabled_workloads: frozenset[str] = field(default_factory=frozenset)


def default_cache_policy_config() -> CachePolicyConfig:
    """Initial config per plan §15: ``mode=observe``, ``ttl=5m``, no workloads."""
    return CachePolicyConfig(mode="observe", ttl="5m", enabled_workloads=frozenset())


def _parse_mode(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.strip().lower()
    return v if v in _MODES else None


def _parse_ttl(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.strip().lower()
    return v if v in _TTLS else None


def parse_enabled_workloads(value: Optional[str]) -> frozenset[str]:
    """Parse a comma/space-separated workload list into a set of workloads.

    Unrecognized tokens are ignored (fail-closed: a typo never enables an
    unintended workload). Accepts both ``ask_wren`` and the plan's hyphenated
    ``ask-wren`` spelling.
    """
    if not value:
        return frozenset()
    result: set[str] = set()
    for raw in re.split(r"[,\s]+", value):
        token = raw.strip().lower().replace("-", "_")
        if token in _WORKLOAD_SET:
            result.add(token)
    return frozenset(result)


def resolve_cache_policy_config(
    *,
    mode: Optional[str] = None,
    ttl: Optional[str] = None,
    enabled_workloads: Optional[Iterable[str]] = None,
    env: Optional[Mapping[str, str]] = None,
) -> CachePolicyConfig:
    """Resolve the effective config from explicit values first, then env, then
    the plan §15 defaults.

    Env keys: ``CACHE_MODE``, ``CACHE_TTL``, ``CACHE_ENABLED_WORKLOADS``. ``env``
    is injectable (no globals) so tests need no ``os.environ``.
    """
    env = env if env is not None else os.environ

    resolved_mode = mode or _parse_mode(env.get("CACHE_MODE")) or "observe"
    resolved_ttl = ttl or _parse_ttl(env.get("CACHE_TTL")) or "5m"
    if enabled_workloads is not None:
        resolved_workloads = frozenset(enabled_workloads)
    else:
        resolved_workloads = parse_enabled_workloads(
            env.get("CACHE_ENABLED_WORKLOADS")
        )
    return CachePolicyConfig(
        mode=resolved_mode, ttl=resolved_ttl, enabled_workloads=resolved_workloads
    )


@dataclass(frozen=True)
class CacheDecision:
    """Structured, deterministic output of :func:`resolve_cache_decision`.

    ``reason`` is one of: ``mode_off``, ``mode_observe``, ``workload_not_enabled``,
    ``unsupported_model``, ``explicit_enabled``.
    """

    apply_explicit_cache: bool
    reason: str
    ttl: Optional[str] = None


def resolve_cache_decision(
    *,
    mode: str,
    ttl: str,
    workload: str,
    model_id: str,
    enabled_workloads: Iterable[str],
) -> CacheDecision:
    """Decide whether explicit caching applies to a single invocation (§14/§15).

    ``apply_explicit_cache`` is True ONLY when ALL hold:
      - ``mode == "explicit"``, AND
      - ``workload`` is in ``enabled_workloads``, AND
      - the model (normalized) has a capability with ``supports_explicit_cache``.

    In ``off`` and ``observe`` modes it is ALWAYS False. An unknown/non-Anthropic
    model yields False with reason ``unsupported_model``. Decision only — no
    request is built and no marker is emitted here.
    """
    if mode == "off":
        return CacheDecision(apply_explicit_cache=False, reason="mode_off")
    if mode == "observe":
        return CacheDecision(apply_explicit_cache=False, reason="mode_observe")

    # Fail-closed guard: any mode that is neither "off"/"observe" (handled above)
    # nor exactly "explicit" — e.g. an unknown/typo'd mode passed directly to this
    # public function — must NEVER cache. Kept intentionally (NOT removed): the
    # audit called it "unreachable", but that only holds when callers normalize
    # mode via resolve_cache_policy_config first. This function is public and
    # callable with an arbitrary mode string, so this guard is the fail-closed
    # backstop and removing it would let an unknown mode reach "explicit_enabled".
    if mode != "explicit":
        return CacheDecision(apply_explicit_cache=False, reason="mode_off")

    enabled = set(enabled_workloads)
    if workload not in enabled:
        return CacheDecision(
            apply_explicit_cache=False, reason="workload_not_enabled"
        )

    capability = lookup_model_capability(model_id)
    if capability is None or not capability.supports_explicit_cache:
        return CacheDecision(
            apply_explicit_cache=False, reason="unsupported_model"
        )

    return CacheDecision(
        apply_explicit_cache=True, reason="explicit_enabled", ttl=ttl
    )


# Conservative chars→tokens estimate for the token-floor gate (plan §7). A
# stable prefix is only considered eligible when it plausibly meets the model
# minimum; ~4 chars/token is the standard conservative rule of thumb (matches
# handler._CHARS_PER_TOKEN_ESTIMATE so the DECISION and the request builder agree).
CHARS_PER_TOKEN_ESTIMATE = 4


def estimate_stable_prefix_tokens(*prefix_parts: str) -> int:
    """Conservatively estimate the token count of the stable/trusted prefix.

    Sums the character length of every trusted prefix part (system scaffolding,
    document-type config, approved reference blocks, rubric text, etc.) and
    divides by :data:`CHARS_PER_TOKEN_ESTIMATE` (integer floor). This mirrors the
    estimate used by the primary-generation request builder so the eligibility
    DECISION and the actual checkpoint gate never disagree.

    Non-string / falsy parts contribute 0. This is a pure estimate — it never
    tokenizes with a model and never inspects prompt CONTENT for anything other
    than length, so it stays privacy-safe and deterministic.
    """
    total_chars = 0
    for part in prefix_parts:
        if isinstance(part, str):
            total_chars += len(part)
    return total_chars // CHARS_PER_TOKEN_ESTIMATE


@dataclass(frozen=True)
class EligibilityDecision:
    """Structured output of :func:`is_explicit_cache_eligible`.

    ``eligible`` is the single boolean a caller gates on. ``reason`` explains the
    outcome and is one of the :class:`CacheDecision` reasons plus ``below_floor``
    (policy would allow caching but the estimated stable prefix is under the
    model minimum) and ``no_capability`` (model has no capability entry).
    ``estimated_prefix_tokens`` and ``min_cache_tokens`` are surfaced so callers
    can record the eligible-but-skipped signal in telemetry.
    """

    eligible: bool
    reason: str
    estimated_prefix_tokens: int
    min_cache_tokens: Optional[int]
    ttl: Optional[str] = None

    def __bool__(self) -> bool:  # pragma: no cover - convenience only
        return self.eligible


def is_explicit_cache_eligible(
    *,
    workload: str,
    model_id: str,
    estimated_prefix_tokens: int,
    mode: str,
    ttl: str,
    enabled_workloads: Iterable[str],
) -> EligibilityDecision:
    """Decide whether a workload is eligible for an explicit cache checkpoint.

    This is the SHARED, reusable eligibility gate for every generative workload
    (primary and secondary). It is DECISION-ONLY: it builds no request, adds no
    ``cache_control`` marker, and changes no prompt/output/error behavior. It
    returns ``eligible=True`` ONLY when ALL of the following hold:

      1. ``mode == "explicit"`` (``off``/``observe`` are never eligible), AND
      2. ``workload`` is in ``enabled_workloads``, AND
      3. the (normalized) model has a capability with ``supports_explicit_cache``,
         AND
      4. ``estimated_prefix_tokens >= capability.min_cache_tokens``.

    Under the plan §15 default posture (``mode=observe``, no workloads enabled)
    this ALWAYS returns ``eligible=False`` for every workload, including the three
    secondary workloads (``resolution_judge``, ``strength_fill``, ``quote_fill``),
    whose short prompts also typically fall below the token floor. The token-floor
    check reuses the same conservative estimate as the primary request builder.
    """
    decision = resolve_cache_decision(
        mode=mode,
        ttl=ttl,
        workload=workload,
        model_id=model_id,
        enabled_workloads=enabled_workloads,
    )

    capability = lookup_model_capability(model_id)
    min_cache_tokens = capability.min_cache_tokens if capability is not None else None

    # Policy (mode × workload × model) must allow caching first.
    if not decision.apply_explicit_cache:
        return EligibilityDecision(
            eligible=False,
            reason=decision.reason,
            estimated_prefix_tokens=estimated_prefix_tokens,
            min_cache_tokens=min_cache_tokens,
        )

    # Policy allows it; now apply the economic token floor (plan §7/§9). A
    # capability is guaranteed here because apply_explicit_cache was True.
    if min_cache_tokens is None:
        # Defensive: policy said supported but no capability entry — fail closed.
        return EligibilityDecision(
            eligible=False,
            reason="no_capability",
            estimated_prefix_tokens=estimated_prefix_tokens,
            min_cache_tokens=None,
        )

    if estimated_prefix_tokens < min_cache_tokens:
        return EligibilityDecision(
            eligible=False,
            reason="below_floor",
            estimated_prefix_tokens=estimated_prefix_tokens,
            min_cache_tokens=min_cache_tokens,
        )

    return EligibilityDecision(
        eligible=True,
        reason="explicit_enabled",
        estimated_prefix_tokens=estimated_prefix_tokens,
        min_cache_tokens=min_cache_tokens,
        ttl=decision.ttl,
    )


def is_cache_validation_error(error: Any) -> bool:
    """Classify whether an error is a CLEAR cache syntax/capability rejection
    that should trigger a SINGLE uncached retry (plan §15; consumed by Task 5+).

    Conservative by design: recognizes only Bedrock/Anthropic validation errors
    whose message clearly references cache_control / prompt caching syntax or
    capability. Arbitrary failures (throttling, timeouts, access denied, model
    errors, generic validation errors) MUST NOT be classified as retryable.
    """
    if error is None:
        return False

    name = ""
    message = ""
    if isinstance(error, str):
        message = error
    elif isinstance(error, BaseException):
        name = type(error).__name__
        message = str(error)
        # botocore ClientError carries the API code under response.Error.Code.
        response = getattr(error, "response", None)
        if isinstance(response, dict):
            code = response.get("Error", {}).get("Code")
            if isinstance(code, str):
                name = f"{name} {code}"
    elif isinstance(error, Mapping):
        raw_name = error.get("name") or error.get("__type") or error.get("Code")
        if isinstance(raw_name, str):
            name = raw_name
        raw_message = error.get("message")
        if isinstance(raw_message, str):
            message = raw_message
    else:
        return False

    haystack = f"{name}\n{message}".lower()

    is_validation_class = (
        "validationexception" in haystack
        or "validation error" in haystack
        or "invalid" in haystack
        or "malformed" in haystack
        or "unsupported" in haystack
        or "not supported" in haystack
    )
    if not is_validation_class:
        return False

    mentions_cache = (
        "cache_control" in haystack
        or "cachecontrol" in haystack
        or "cache control" in haystack
        or "cache checkpoint" in haystack
        or "prompt cache" in haystack
        or "prompt caching" in haystack
        or "caching" in haystack
    )
    return mentions_cache
