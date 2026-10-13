"""Eligibility-gate tests for the secondary Bedrock workloads (prompt-cache Task 8).

Covers docs/prompt-cache-plan.md §7/§9/§14/§15 for the three secondary
workloads that are initially "observe" (never cached by default):
``resolution_judge``, ``strength_fill``, ``quote_fill``.

The shared, reusable eligibility gate lives in ``wren_engine.cache_policy``
(:func:`is_explicit_cache_eligible` + :func:`estimate_stable_prefix_tokens`). It
is DECISION-ONLY: it builds no request and adds no ``cache_control`` marker.
These tests assert:

  1. Under the plan §15 DEFAULT config (``mode=observe``, no workloads enabled),
     eligibility is FALSE for all three secondary workloads.
  2. Even in ``explicit`` mode, eligibility is FALSE when the model is
     unsupported OR the estimated stable prefix is below the model minimum
     (1,024 tokens), for every workload.
  3. Eligibility is TRUE only when explicit + workload-enabled + supported model
     + estimated prefix >= min.
  4. Representative REAL secondary prompts (judge rubric, strength fill, quote
     fill) are typically BELOW the 1,024-token floor — the economic reason these
     workloads stay in observe mode — so the gate returns FALSE for them even if
     someone flips the mode/workload flags.

No live AWS: these are pure-function tests plus one no-cache_control check on the
serialized bodies of the fill prompts (which are plain strings anyway).
"""
from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wren_engine.cache_policy import (  # noqa: E402
    CACHE_WORKLOADS,
    CHARS_PER_TOKEN_ESTIMATE,
    default_cache_policy_config,
    estimate_stable_prefix_tokens,
    is_explicit_cache_eligible,
    lookup_model_capability,
)
from wren_engine.strength_coverage import build_strength_fill_prompt  # noqa: E402

import handler  # noqa: E402


SUPPORTED_MODEL = "anthropic.claude-sonnet-4-6"
SUPPORTED_CRIS = "us.anthropic.claude-sonnet-4-6"
UNKNOWN_MODEL = "meta.llama3-70b-instruct-v1:0"

# The three secondary workloads (plan §14: all initially "observe").
SECONDARY_WORKLOADS = ("resolution_judge", "strength_fill", "quote_fill")

# A stable prefix comfortably above the 1,024-token floor (~4 chars/token → need
# ~4,096+ chars). Used to isolate the mode/workload/model conditions from the
# token-floor condition.
_LARGE_PREFIX = "x" * (CHARS_PER_TOKEN_ESTIMATE * 4096)
_LARGE_PREFIX_TOKENS = estimate_stable_prefix_tokens(_LARGE_PREFIX)


# --------------------------------------------------------------------------- #
# estimate_stable_prefix_tokens                                                #
# --------------------------------------------------------------------------- #


class TestEstimateStablePrefixTokens:
    def test_conservative_chars_over_four(self):
        assert estimate_stable_prefix_tokens("a" * 4096) == 1024
        assert estimate_stable_prefix_tokens("a" * 4095) == 1023  # floor division

    def test_sums_multiple_parts(self):
        assert estimate_stable_prefix_tokens("a" * 2048, "b" * 2048) == 1024

    def test_ignores_non_string_and_empty(self):
        assert estimate_stable_prefix_tokens("", None, 123) == 0  # type: ignore[arg-type]

    def test_large_prefix_helper_exceeds_floor(self):
        assert _LARGE_PREFIX_TOKENS >= 1024


# --------------------------------------------------------------------------- #
# 1. Default (observe) config → every secondary workload ineligible            #
# --------------------------------------------------------------------------- #


class TestDefaultObserveIneligible:
    @pytest.mark.parametrize("workload", SECONDARY_WORKLOADS)
    def test_default_config_is_ineligible_even_with_large_prefix(self, workload):
        cfg = default_cache_policy_config()
        decision = is_explicit_cache_eligible(
            workload=workload,
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=_LARGE_PREFIX_TOKENS,
            mode=cfg.mode,
            ttl=cfg.ttl,
            enabled_workloads=cfg.enabled_workloads,
        )
        assert decision.eligible is False
        assert decision.reason == "mode_observe"
        assert bool(decision) is False

    @pytest.mark.parametrize("workload", CACHE_WORKLOADS)
    def test_off_mode_is_ineligible(self, workload):
        decision = is_explicit_cache_eligible(
            workload=workload,
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=_LARGE_PREFIX_TOKENS,
            mode="off",
            ttl="5m",
            enabled_workloads=CACHE_WORKLOADS,
        )
        assert decision.eligible is False
        assert decision.reason == "mode_off"


# --------------------------------------------------------------------------- #
# 2. Explicit mode but blocked by workload / model / floor                     #
# --------------------------------------------------------------------------- #


class TestExplicitModeBlockers:
    @pytest.mark.parametrize("workload", SECONDARY_WORKLOADS)
    def test_explicit_but_workload_not_enabled(self, workload):
        decision = is_explicit_cache_eligible(
            workload=workload,
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=_LARGE_PREFIX_TOKENS,
            mode="explicit",
            ttl="5m",
            enabled_workloads=[],  # nothing enabled
        )
        assert decision.eligible is False
        assert decision.reason == "workload_not_enabled"

    @pytest.mark.parametrize("workload", SECONDARY_WORKLOADS)
    def test_explicit_enabled_but_unsupported_model(self, workload):
        decision = is_explicit_cache_eligible(
            workload=workload,
            model_id=UNKNOWN_MODEL,
            estimated_prefix_tokens=_LARGE_PREFIX_TOKENS,
            mode="explicit",
            ttl="5m",
            enabled_workloads=[workload],
        )
        assert decision.eligible is False
        assert decision.reason == "unsupported_model"

    @pytest.mark.parametrize("workload", SECONDARY_WORKLOADS)
    def test_explicit_enabled_supported_but_below_floor(self, workload):
        min_tokens = lookup_model_capability(SUPPORTED_MODEL).min_cache_tokens
        decision = is_explicit_cache_eligible(
            workload=workload,
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=min_tokens - 1,  # one token short
            mode="explicit",
            ttl="5m",
            enabled_workloads=[workload],
        )
        assert decision.eligible is False
        assert decision.reason == "below_floor"
        assert decision.min_cache_tokens == min_tokens
        assert decision.estimated_prefix_tokens == min_tokens - 1


# --------------------------------------------------------------------------- #
# 3. Eligible only when ALL conditions hold                                    #
# --------------------------------------------------------------------------- #


class TestExplicitEligible:
    @pytest.mark.parametrize("workload", SECONDARY_WORKLOADS)
    @pytest.mark.parametrize("model", [SUPPORTED_MODEL, SUPPORTED_CRIS])
    def test_true_only_when_explicit_enabled_supported_and_at_or_above_floor(
        self, workload, model
    ):
        min_tokens = lookup_model_capability(model).min_cache_tokens
        # Exactly at the floor is eligible (>= min).
        at_floor = is_explicit_cache_eligible(
            workload=workload,
            model_id=model,
            estimated_prefix_tokens=min_tokens,
            mode="explicit",
            ttl="1h",
            enabled_workloads=[workload],
        )
        assert at_floor.eligible is True
        assert at_floor.reason == "explicit_enabled"
        assert at_floor.ttl == "1h"

        # Well above the floor is also eligible.
        above = is_explicit_cache_eligible(
            workload=workload,
            model_id=model,
            estimated_prefix_tokens=min_tokens + 5000,
            mode="explicit",
            ttl="5m",
            enabled_workloads=[workload],
        )
        assert above.eligible is True
        assert above.ttl == "5m"


# --------------------------------------------------------------------------- #
# 4. Representative REAL secondary prompts fall below the 1,024-token floor     #
# --------------------------------------------------------------------------- #


def _judge_rubric_prefix() -> str:
    """The stable trusted prefix of the resolution-judge prompt: its system
    rubric. This mirrors the ``system_text`` built in
    ``handler.judge_resolutions_with_llm`` (the per-request items JSON is the
    dynamic, uncacheable tail and is NOT part of the stable prefix)."""
    return (
        'You evaluate whether a student addressed specific writing feedback when revising their draft.\n'
        'For each item you receive:\n'
        '  - "feedback_question": the coaching question that was raised about their writing\n'
        '  - "original_text": the text that was originally flagged (may be empty for structural feedback)\n'
        '  - "revised_text": the relevant section from the student\'s revised draft\n\n'
        'Compare the original to the revision in light of the feedback question. '
        'Reply with exactly one verdict per item:\n'
        '  resolved   - the revision clearly and fully addresses the concern raised by the feedback\n'
        '  partial    - the revision shows meaningful progress toward addressing the feedback, but the concern is not fully resolved\n'
        '  unresolved - the revision does not address the feedback, or the relevant text is essentially unchanged\n\n'
        'When in doubt between "partial" and "unresolved", prefer "partial" if the student made any '
        'relevant change in the direction the feedback suggested.\n'
        'Reply as a JSON array of objects with "id" and "verdict" fields only. No other text.'
    )


def _strength_fill_prompt() -> str:
    return build_strength_fill_prompt(
        document_text="A short student paragraph that argues a point with one citation.",
        missing_categories=[
            ("11111111-1111-1111-1111-111111111111", "Thesis Clarity"),
            ("22222222-2222-2222-2222-222222222222", "Citation Form"),
        ],
    )


def _quote_fill_prompt() -> str:
    return handler._build_quote_fallback_prompt(
        missing_sections=["strength", "inline"],
        document_text="A short student paragraph that argues a point with one citation.",
        category_ids=[
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        ],
        category_names=["Thesis Clarity", "Citation Form"],
    )


class TestRepresentativePromptsBelowFloor:
    """Even if a future operator flips mode=explicit and enables one of these
    workloads, the typical prompt is below the 1,024-token floor, so the shared
    gate still returns ineligible — the economic justification for keeping these
    workloads in observe mode (plan §14)."""

    def test_judge_rubric_prefix_below_floor(self):
        tokens = estimate_stable_prefix_tokens(_judge_rubric_prefix())
        assert tokens < 1024, f"judge rubric estimated at {tokens} tokens"
        decision = is_explicit_cache_eligible(
            workload="resolution_judge",
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=tokens,
            mode="explicit",
            ttl="5m",
            enabled_workloads=["resolution_judge"],
        )
        assert decision.eligible is False
        assert decision.reason == "below_floor"

    def test_strength_fill_prompt_below_floor(self):
        tokens = estimate_stable_prefix_tokens(_strength_fill_prompt())
        assert tokens < 1024, f"strength fill prompt estimated at {tokens} tokens"
        decision = is_explicit_cache_eligible(
            workload="strength_fill",
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=tokens,
            mode="explicit",
            ttl="5m",
            enabled_workloads=["strength_fill"],
        )
        assert decision.eligible is False
        assert decision.reason == "below_floor"

    def test_quote_fill_prompt_below_floor(self):
        tokens = estimate_stable_prefix_tokens(_quote_fill_prompt())
        assert tokens < 1024, f"quote fill prompt estimated at {tokens} tokens"
        decision = is_explicit_cache_eligible(
            workload="quote_fill",
            model_id=SUPPORTED_MODEL,
            estimated_prefix_tokens=tokens,
            mode="explicit",
            ttl="5m",
            enabled_workloads=["quote_fill"],
        )
        assert decision.eligible is False
        assert decision.reason == "below_floor"


# --------------------------------------------------------------------------- #
# 5. No cache_control leaks into the representative secondary prompt bodies     #
# --------------------------------------------------------------------------- #


def test_representative_secondary_prompts_contain_no_cache_control():
    # The fill prompts are plain strings; the judge rubric likewise. None of the
    # eligibility machinery mutates them, so no cache marker can appear.
    for text in (_judge_rubric_prefix(), _strength_fill_prompt(), _quote_fill_prompt()):
        assert "cache_control" not in text

    # And a serialized Anthropic-style body built from a fill prompt (the shape
    # invoke_bedrock would send) carries no cache markers.
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": _strength_fill_prompt()}],
        "temperature": 0.4,
    }
    assert "cache_control" not in json.dumps(body)
