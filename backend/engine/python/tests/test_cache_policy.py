"""Unit tests for the cache capability & policy DECISION LAYER (prompt-cache Task 4).

Python mirror of ``backend/feedback/src/cachePolicy.test.ts``. No live AWS.
Covers capability lookup (supported / unknown / cross-region / bare ids),
content-class approval (prohibited never cacheable), the full decision matrix
(mode × workload-enabled × supported/unknown model), config resolution, and the
cache-validation-error classifier.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wren_engine.cache_policy import (  # noqa: E402
    CACHE_WORKLOADS,
    APPROVED_CONTENT_CLASSES,
    PROHIBITED_CONTENT_CLASSES,
    default_cache_policy_config,
    is_cache_validation_error,
    lookup_model_capability,
    may_content_class_be_cached,
    normalize_model_key,
    parse_enabled_workloads,
    resolve_cache_decision,
    resolve_cache_policy_config,
)

SUPPORTED_CRIS = "us.anthropic.claude-sonnet-4-6"
SUPPORTED_BARE = "anthropic.claude-sonnet-4-6"
SUPPORTED_EU = "eu.anthropic.claude-sonnet-4-6"
UNKNOWN_MODEL = "meta.llama3-70b-instruct-v1:0"
NON_ANTHROPIC = "us.amazon.nova-pro-v1:0"


class TestNormalizeModelKey:
    def test_region_prefixes_collapse_to_one_key(self):
        assert normalize_model_key(SUPPORTED_CRIS) == "anthropic.claude-sonnet-4-6"
        assert normalize_model_key(SUPPORTED_BARE) == "anthropic.claude-sonnet-4-6"
        assert normalize_model_key(SUPPORTED_EU) == "anthropic.claude-sonnet-4-6"
        assert (
            normalize_model_key("APAC.Anthropic.Claude-Sonnet-4-6")
            == "anthropic.claude-sonnet-4-6"
        )

    def test_empty_input(self):
        assert normalize_model_key("") == ""
        assert normalize_model_key("   ") == ""


class TestLookupModelCapability:
    @pytest.mark.parametrize("model", [SUPPORTED_CRIS, SUPPORTED_BARE, SUPPORTED_EU])
    def test_supported_model_all_region_forms(self, model):
        cap = lookup_model_capability(model)
        assert cap is not None
        assert cap.supports_explicit_cache is True
        assert cap.min_cache_tokens == 1024
        assert cap.max_checkpoints == 4
        assert cap.ttls == ("5m", "1h")
        assert cap.cache_fields == ("system", "messages", "tools")

    @pytest.mark.parametrize("model", [UNKNOWN_MODEL, NON_ANTHROPIC, ""])
    def test_unknown_or_non_anthropic_is_none(self, model):
        assert lookup_model_capability(model) is None


class TestMayContentClassBeCached:
    @pytest.mark.parametrize("cls", sorted(APPROVED_CONTENT_CLASSES))
    def test_approved_may_be_cached(self, cls):
        assert may_content_class_be_cached(cls) is True

    @pytest.mark.parametrize("cls", sorted(PROHIBITED_CONTENT_CLASSES))
    def test_prohibited_never_cacheable(self, cls):
        assert may_content_class_be_cached(cls) is False

    def test_prohibited_classes_expected_set(self):
        assert PROHIBITED_CONTENT_CLASSES == frozenset(
            {
                "student_draft",
                "student_footnotes",
                "student_question",
                "conversation_history",
                "model_response",
            }
        )

    def test_unrecognized_is_fail_closed(self):
        assert may_content_class_be_cached("something_else") is False
        assert may_content_class_be_cached("") is False


class TestConfigResolution:
    def test_defaults(self):
        cfg = default_cache_policy_config()
        assert cfg.mode == "observe"
        assert cfg.ttl == "5m"
        assert cfg.enabled_workloads == frozenset()

    def test_resolves_from_injected_env(self):
        cfg = resolve_cache_policy_config(
            env={
                "CACHE_MODE": "explicit",
                "CACHE_TTL": "1h",
                "CACHE_ENABLED_WORKLOADS": "ask-wren, feedback_primary",
            }
        )
        assert cfg.mode == "explicit"
        assert cfg.ttl == "1h"
        assert cfg.enabled_workloads == frozenset({"ask_wren", "feedback_primary"})

    def test_explicit_overrides_beat_env_and_garbage_falls_back(self):
        cfg = resolve_cache_policy_config(
            mode="observe",
            env={"CACHE_MODE": "explicit", "CACHE_TTL": "nonsense"},
        )
        assert cfg.mode == "observe"
        assert cfg.ttl == "5m"

    def test_parse_enabled_workloads_ignores_unrecognized(self):
        parsed = parse_enabled_workloads("ask_wren, bogus, resolution-judge")
        assert parsed == frozenset({"ask_wren", "resolution_judge"})


class TestResolveCacheDecisionMatrix:
    @pytest.mark.parametrize("workload", CACHE_WORKLOADS)
    @pytest.mark.parametrize("model", [SUPPORTED_CRIS, UNKNOWN_MODEL])
    def test_off_always_false(self, workload, model):
        d = resolve_cache_decision(
            mode="off",
            ttl="5m",
            workload=workload,
            model_id=model,
            enabled_workloads=CACHE_WORKLOADS,
        )
        assert d.apply_explicit_cache is False
        assert d.reason == "mode_off"
        assert d.ttl is None

    @pytest.mark.parametrize("workload", CACHE_WORKLOADS)
    @pytest.mark.parametrize("model", [SUPPORTED_CRIS, UNKNOWN_MODEL])
    def test_observe_always_false(self, workload, model):
        d = resolve_cache_decision(
            mode="observe",
            ttl="5m",
            workload=workload,
            model_id=model,
            enabled_workloads=CACHE_WORKLOADS,
        )
        assert d.apply_explicit_cache is False
        assert d.reason == "mode_observe"

    @pytest.mark.parametrize("workload", CACHE_WORKLOADS)
    def test_explicit_enabled_supported_true(self, workload):
        d = resolve_cache_decision(
            mode="explicit",
            ttl="1h",
            workload=workload,
            model_id=SUPPORTED_BARE,
            enabled_workloads=CACHE_WORKLOADS,
        )
        assert d.apply_explicit_cache is True
        assert d.reason == "explicit_enabled"
        assert d.ttl == "1h"

    def test_explicit_not_enabled_false(self):
        d = resolve_cache_decision(
            mode="explicit",
            ttl="5m",
            workload="ask_wren",
            model_id=SUPPORTED_CRIS,
            enabled_workloads=[],
        )
        assert d.apply_explicit_cache is False
        assert d.reason == "workload_not_enabled"

    @pytest.mark.parametrize("model", [UNKNOWN_MODEL, NON_ANTHROPIC, ""])
    def test_explicit_unknown_model_false(self, model):
        d = resolve_cache_decision(
            mode="explicit",
            ttl="5m",
            workload="ask_wren",
            model_id=model,
            enabled_workloads=CACHE_WORKLOADS,
        )
        assert d.apply_explicit_cache is False
        assert d.reason == "unsupported_model"


class TestIsCacheValidationError:
    def test_accepts_cache_control_syntax_rejection(self):
        class ValidationException(Exception):
            pass

        assert (
            is_cache_validation_error(
                ValidationException("Invalid cache_control block in messages")
            )
            is True
        )

    def test_accepts_prompt_caching_capability_rejections(self):
        assert (
            is_cache_validation_error(
                Exception("ValidationException: prompt caching is not supported")
            )
            is True
        )
        assert (
            is_cache_validation_error(
                {
                    "__type": "ValidationException",
                    "message": "Unsupported cache checkpoint field",
                }
            )
            is True
        )

    def test_accepts_botocore_style_client_error(self):
        class ClientError(Exception):
            def __init__(self, code, message):
                super().__init__(message)
                self.response = {"Error": {"Code": code}}

        err = ClientError(
            "ValidationException", "malformed cache_control on system block"
        )
        assert is_cache_validation_error(err) is True

    def test_rejects_arbitrary_errors(self):
        assert (
            is_cache_validation_error(Exception("ThrottlingException: rate exceeded"))
            is False
        )
        assert (
            is_cache_validation_error(Exception("AccessDeniedException: not authorized"))
            is False
        )
        assert (
            is_cache_validation_error(
                Exception("ValidationException: max_tokens too large")
            )
            is False
        )
        assert is_cache_validation_error(Exception("some random failure")) is False

    def test_rejects_none_and_non_error(self):
        assert is_cache_validation_error(None) is False
        assert is_cache_validation_error(42) is False
        assert is_cache_validation_error({}) is False
