"""Tests for deterministic approved-reference caching in primary generation.

Covers prompt-cache plan Task 7 (docs/prompt-cache-plan.md §7/§9/§10/§12.2/§14/§15),
implemented with OPTION B (dynamic focus/density directives relocated to AFTER the
cache checkpoint on the CACHED path only).

Guardrails asserted here:
  1. OFF/default path: request body is the legacy flat structure — a string
     ``system`` and a single user-message STRING — with NO ``cache_control``
     anywhere. Byte-identical to what invoke_bedrock builds today.
  2. Student content (draft/footnotes/submitted-content framing) NEVER appears in
     or before the cached prefix / checkpoint; student blocks are unmarked.
  3. The random per-assembly boundary around untrusted student data is preserved.
  4. Reference caching does not change the SEMANTIC content the model sees — only
     block structure and (cached path) the position of the dynamic directives.

No live AWS: ``handler.boto3.client`` is patched with a fake that records the
request body and returns a canned Anthropic reply.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_engine import prompt_assembly  # noqa: E402


# --------------------------------------------------------------------------- #
# Fakes / helpers                                                             #
# --------------------------------------------------------------------------- #


class _FakeBody:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw


class _FakeBedrockClient:
    """Records invoke_model requests and returns a canned Anthropic reply."""

    def __init__(self, payload: dict[str, Any], *, raise_on: list[Exception] | None = None) -> None:
        self._payload = payload
        self._raise_on = list(raise_on or [])
        self.calls: list[dict[str, Any]] = []

    def invoke_model(self, *, modelId: str, body: str) -> dict[str, Any]:  # noqa: N803
        self.calls.append({"modelId": modelId, "body": body})
        if self._raise_on:
            raise self._raise_on.pop(0)
        return {"body": _FakeBody(self._payload)}


def _install_fake_client(monkeypatch, payload: dict[str, Any], *, raise_on=None) -> _FakeBedrockClient:
    fake = _FakeBedrockClient(payload, raise_on=raise_on)

    def _fake_client(service_name: str, **_kwargs: Any) -> _FakeBedrockClient:
        assert service_name == "bedrock-runtime"
        return fake

    monkeypatch.setattr(handler.boto3, "client", _fake_client)
    return fake


def _canned(text: str = "[]", stop_reason: str = "end_turn") -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "stop_reason": stop_reason}


def _explicit_env(monkeypatch) -> None:
    """Enable explicit caching for feedback_primary on the supported model."""
    monkeypatch.setenv("CACHE_MODE", "explicit")
    monkeypatch.setenv("CACHE_TTL", "5m")
    monkeypatch.setenv("CACHE_ENABLED_WORKLOADS", "feedback_primary")


def _off_env(monkeypatch) -> None:
    """Explicitly clear cache env so the DEFAULT (observe) policy applies."""
    for key in ("CACHE_MODE", "CACHE_TTL", "CACHE_ENABLED_WORKLOADS"):
        monkeypatch.delenv(key, raising=False)


_MODEL = "anthropic.claude-sonnet-4-6"
_CONFIG = {"bedrock_model_id": _MODEL, "temperature": 0.4}

# A document-type config large enough to comfortably exceed the 1024-token floor
# (~4096+ chars) so the checkpoint is emitted on the cached path.
_BIG_INSTRUCTIONS = "Follow these detailed drafting conventions carefully. " * 120

_DOC_TYPE_META = {
    "name": "Legal Memo",
    "category_ids": ["11111111-1111-1111-1111-111111111111"],
    "category_names": ["Citation Form"],
    "category_guidance": {"11111111-1111-1111-1111-111111111111": "Check citations."},
}

_SEGMENTS = [{"text": "First paragraph body."}, {"text": "Second paragraph body."}]


def _base_config(instructions: str = _BIG_INSTRUCTIONS) -> dict[str, Any]:
    return {
        "type_prompt_text": instructions,
        "tone": "supportive",
        "tone_description": "warm and encouraging",
        "density": "medium",
        "structure_description": "mcgill",
        "restrictions_description": "No first person.",
        "notes_description": "Cite everything.",
    }


def _build(monkeypatch, *, refs=None, focus=None, instructions=_BIG_INSTRUCTIONS, footnotes=None):
    """Build a structured prompt with a pinned boundary token for determinism."""
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "FIXEDTOKEN")
    return handler.build_structured_prompt(
        _base_config(instructions),
        _DOC_TYPE_META,
        "Department instructions here.",
        _SEGMENTS,
        refs or [],
        focus_paragraph_indices=focus,
        footnotes=footnotes,
    )


# --------------------------------------------------------------------------- #
# 1. OFF / default path — byte-identical legacy structure                      #
# --------------------------------------------------------------------------- #


def test_off_path_sends_legacy_flat_structure(monkeypatch):
    _off_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build(monkeypatch, refs=[{"title": "Guide", "content": "Ref body.", "key": "k1"}])

    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")

    body = json.loads(fake.calls[0]["body"])
    # String system, single user-message STRING (legacy flat structure).
    assert isinstance(body["system"], str)
    assert isinstance(body["messages"], list) and len(body["messages"]) == 1
    assert body["messages"][0]["role"] == "user"
    assert isinstance(body["messages"][0]["content"], str)
    # No cache markers anywhere.
    assert "cache_control" not in fake.calls[0]["body"]


def test_off_path_body_byte_identical_to_invoke_bedrock(monkeypatch):
    """The OFF-path body must equal exactly what invoke_bedrock builds today."""
    _off_env(monkeypatch)
    structured = _build(monkeypatch, refs=[{"title": "Guide", "content": "Ref body.", "key": "k1"}])
    flat_prompt = structured.render()

    # Capture the cached-wrapper (OFF) body.
    fake_a = _install_fake_client(monkeypatch, _canned())
    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")
    body_via_cached = fake_a.calls[0]["body"]

    # Capture the legacy invoke_bedrock body for the same flat prompt.
    fake_b = _install_fake_client(monkeypatch, _canned())
    handler.invoke_bedrock(flat_prompt, _CONFIG, max_tokens=512, workload="feedback_primary")
    body_via_plain = fake_b.calls[0]["body"]

    assert body_via_cached == body_via_plain


# --------------------------------------------------------------------------- #
# 2. Explicit + enabled + supported model + sufficient prefix → content blocks #
# --------------------------------------------------------------------------- #


def test_cached_path_uses_content_blocks_with_single_checkpoint(monkeypatch):
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build(
        monkeypatch,
        refs=[
            {"title": "A", "content": "Alpha ref " * 200, "key": "k-a"},
            {"title": "B", "content": "Bravo ref " * 200, "key": "k-b"},
        ],
    )

    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")

    body = json.loads(fake.calls[0]["body"])
    assert isinstance(body["system"], str)
    content = body["messages"][0]["content"]
    assert isinstance(content, list)

    # Exactly one cache_control across all blocks.
    marked = [i for i, b in enumerate(content) if "cache_control" in b]
    assert len(marked) == 1
    checkpoint_idx = marked[0]

    # cache_control shape: ephemeral, no ttl key for 5m.
    assert content[checkpoint_idx]["cache_control"] == {"type": "ephemeral"}

    # The checkpoint block is the LAST trusted-prefix block (a reference block).
    assert "REFERENCE MATERIAL" in content[checkpoint_idx]["text"]

    # Dynamic directives appear AFTER the checkpoint.
    directive_idxs = [i for i, b in enumerate(content) if "INLINE DENSITY CAP" in b["text"]]
    assert directive_idxs and min(directive_idxs) > checkpoint_idx

    # Student blocks appear AFTER the checkpoint and are UNMARKED.
    student_idxs = [i for i, b in enumerate(content) if "SUBMITTED DOCUMENT" in b["text"]]
    assert student_idxs and min(student_idxs) > checkpoint_idx
    for i in student_idxs:
        assert "cache_control" not in content[i]

    # No block at or before the checkpoint contains student content.
    for i in range(checkpoint_idx + 1):
        assert "SUBMITTED DOCUMENT" not in content[i]["text"]
        assert "BEGIN UNTRUSTED DATA" not in content[i]["text"] or "REFERENCE MATERIAL" in content[i]["text"]


def test_cached_path_checkpoint_on_stable_config_when_no_references(monkeypatch):
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build(monkeypatch, refs=[])

    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")

    body = json.loads(fake.calls[0]["body"])
    content = body["messages"][0]["content"]
    marked = [i for i, b in enumerate(content) if "cache_control" in b]
    assert len(marked) == 1
    # With no references, the checkpoint is on the stable-config block (first).
    assert marked[0] == 0
    assert "Document-Type configuration" in content[0]["text"]
    assert "SUBMITTED DOCUMENT" not in content[0]["text"]


def test_cached_path_ttl_1h_honored(monkeypatch):
    monkeypatch.setenv("CACHE_MODE", "explicit")
    monkeypatch.setenv("CACHE_TTL", "1h")
    monkeypatch.setenv("CACHE_ENABLED_WORKLOADS", "feedback_primary")
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build(monkeypatch, refs=[{"title": "A", "content": "Alpha " * 400, "key": "k-a"}])

    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")

    body = json.loads(fake.calls[0]["body"])
    content = body["messages"][0]["content"]
    marked = [b for b in content if "cache_control" in b]
    assert len(marked) == 1
    assert marked[0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}


# --------------------------------------------------------------------------- #
# 3. Deterministic references                                                  #
# --------------------------------------------------------------------------- #


def _cached_trusted_prefix_text(monkeypatch, refs) -> str:
    """Return the concatenated trusted-prefix block text for the cached body."""
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build(monkeypatch, refs=refs)
    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")
    body = json.loads(fake.calls[0]["body"])
    content = body["messages"][0]["content"]
    # Trusted prefix = everything up to and including the checkpoint block.
    marked = [i for i, b in enumerate(content) if "cache_control" in b][0]
    return "\n".join(b["text"] for b in content[: marked + 1])


def test_shuffled_s3_order_yields_same_trusted_prefix(monkeypatch):
    refs_order_1 = [
        {"title": "A", "content": "Alpha " * 200, "key": "doc/a.txt"},
        {"title": "B", "content": "Bravo " * 200, "key": "doc/b.txt"},
        {"title": "C", "content": "Charlie " * 200, "key": "doc/c.txt"},
    ]
    refs_order_2 = [refs_order_1[2], refs_order_1[0], refs_order_1[1]]

    prefix_1 = _cached_trusted_prefix_text(monkeypatch, refs_order_1)
    prefix_2 = _cached_trusted_prefix_text(monkeypatch, refs_order_2)
    assert prefix_1 == prefix_2


def test_editing_a_reference_changes_trusted_prefix(monkeypatch):
    refs = [{"title": "A", "content": "Alpha " * 200, "key": "doc/a.txt"}]
    refs_edited = [{"title": "A", "content": "Alpha EDITED " * 200, "key": "doc/a.txt"}]
    assert _cached_trusted_prefix_text(monkeypatch, refs) != _cached_trusted_prefix_text(
        monkeypatch, refs_edited
    )


def test_adding_a_reference_changes_trusted_prefix(monkeypatch):
    refs = [{"title": "A", "content": "Alpha " * 200, "key": "doc/a.txt"}]
    refs_more = refs + [{"title": "B", "content": "Bravo " * 200, "key": "doc/b.txt"}]
    assert _cached_trusted_prefix_text(monkeypatch, refs) != _cached_trusted_prefix_text(
        monkeypatch, refs_more
    )


def test_draft_only_change_does_not_change_trusted_prefix(monkeypatch):
    refs = [{"title": "A", "content": "Alpha " * 200, "key": "doc/a.txt"}]
    # Same refs, but the draft differs — trusted prefix must be unchanged.
    _explicit_env(monkeypatch)

    fake1 = _install_fake_client(monkeypatch, _canned())
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "FIXEDTOKEN")
    s1 = handler.build_structured_prompt(
        _base_config(), _DOC_TYPE_META, "Dept.", [{"text": "Draft one."}], refs
    )
    handler.invoke_bedrock_cached(s1, _CONFIG, max_tokens=512, workload="feedback_primary")
    body1 = json.loads(fake1.calls[0]["body"])
    m1 = [i for i, b in enumerate(body1["messages"][0]["content"]) if "cache_control" in b][0]
    prefix1 = "\n".join(b["text"] for b in body1["messages"][0]["content"][: m1 + 1])

    fake2 = _install_fake_client(monkeypatch, _canned())
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "FIXEDTOKEN")
    s2 = handler.build_structured_prompt(
        _base_config(), _DOC_TYPE_META, "Dept.", [{"text": "A completely different draft."}], refs
    )
    handler.invoke_bedrock_cached(s2, _CONFIG, max_tokens=512, workload="feedback_primary")
    body2 = json.loads(fake2.calls[0]["body"])
    m2 = [i for i, b in enumerate(body2["messages"][0]["content"]) if "cache_control" in b][0]
    prefix2 = "\n".join(b["text"] for b in body2["messages"][0]["content"][: m2 + 1])

    assert prefix1 == prefix2


def test_truncating_a_reference_changes_trusted_prefix(monkeypatch):
    # A reference beyond the per-file cap is truncated; capping happens AFTER
    # sorting, so a longer body yields a different (truncated) prefix.
    short = [{"title": "A", "content": "Alpha " * 200, "key": "doc/a.txt"}]
    huge = [{"title": "A", "content": "Alpha " * 5000, "key": "doc/a.txt"}]
    assert _cached_trusted_prefix_text(monkeypatch, short) != _cached_trusted_prefix_text(
        monkeypatch, huge
    )


# --------------------------------------------------------------------------- #
# 4. Below-floor gate                                                          #
# --------------------------------------------------------------------------- #


def _tiny_structured() -> Any:
    """A minimal StructuredFeedbackPrompt whose trusted prefix is below floor.

    Built directly via the PromptAssembler with a tiny scaffolding + config so
    the estimated trusted-prefix token count is well under 1024 (handler's real
    _SCAFFOLDING alone already exceeds the floor).
    """
    from wren_engine import (
        DocumentTypePromptConfig,
        PromptAssembler,
        SystemScaffolding,
        UntrustedContent,
    )

    scaffolding = SystemScaffolding(
        core_instructions="Be brief.",
        output_schema_text="Return [].",
        guardrail_text="No prose.",
    )
    doc_type = DocumentTypePromptConfig(
        document_type_name="X",
        category_names=("C",),
        category_ids=("11111111-1111-1111-1111-111111111111",),
        tone="t",
        density="d",
        type_instructions="Tiny.",
    )
    return PromptAssembler().assemble_structured(
        scaffolding,
        doc_type,
        [],
        [UntrustedContent(label="SUBMITTED DOCUMENT", text="tiny draft")],
        dynamic_directives="INLINE DENSITY CAP: at most 5.",
        boundary_token="FIXEDTOKEN",
    )


def test_below_floor_emits_no_checkpoint_and_falls_back_to_plain(monkeypatch):
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    # Tiny config + no references → trusted prefix well below 1024 tokens.
    structured = _tiny_structured()

    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")

    body = json.loads(fake.calls[0]["body"])
    # Falls back to the plain flat structure: string user content, no markers.
    assert isinstance(body["messages"][0]["content"], str)
    assert "cache_control" not in fake.calls[0]["body"]


def test_below_floor_records_skip_telemetry(monkeypatch):
    _explicit_env(monkeypatch)
    _install_fake_client(monkeypatch, _canned())
    structured = _tiny_structured()

    emitted: list[handler.InvocationUsage] = []
    kwargs_seen: list[dict[str, Any]] = []

    def _fake_emit(usage, **kwargs):
        emitted.append(usage)
        kwargs_seen.append(kwargs)

    monkeypatch.setattr(handler, "emit_telemetry", _fake_emit)

    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")

    assert emitted and emitted[0].workload == "feedback_primary"
    # Recorded as cache-eligible but a fallback (skip below floor).
    assert kwargs_seen[0].get("cache_eligible") is True
    assert kwargs_seen[0].get("cache_fallback") is True


# --------------------------------------------------------------------------- #
# 5. Retry behavior                                                            #
# --------------------------------------------------------------------------- #


def test_cache_validation_error_triggers_single_uncached_retry(monkeypatch):
    _explicit_env(monkeypatch)
    err = ValueError("ValidationException: cache_control field is not supported")
    # First call raises the cache-validation error; second (retry) succeeds.
    fake = _install_fake_client(monkeypatch, _canned(), raise_on=[err])
    structured = _build(monkeypatch, refs=[{"title": "A", "content": "Alpha " * 400, "key": "k"}])

    text, stop = handler.invoke_bedrock_cached(
        structured, _CONFIG, max_tokens=512, workload="feedback_primary"
    )

    assert text == "[]"
    assert len(fake.calls) == 2
    # First call was the cached (content-blocks) body; retry was the plain body.
    first = json.loads(fake.calls[0]["body"])
    second = json.loads(fake.calls[1]["body"])
    assert isinstance(first["messages"][0]["content"], list)
    assert isinstance(second["messages"][0]["content"], str)
    assert "cache_control" not in fake.calls[1]["body"]


def test_arbitrary_error_does_not_retry(monkeypatch):
    _explicit_env(monkeypatch)
    err = RuntimeError("some throttling or timeout, unrelated to caching")
    fake = _install_fake_client(monkeypatch, _canned(), raise_on=[err])
    structured = _build(monkeypatch, refs=[{"title": "A", "content": "Alpha " * 400, "key": "k"}])

    with pytest.raises(RuntimeError):
        handler.invoke_bedrock_cached(
            structured, _CONFIG, max_tokens=512, workload="feedback_primary"
        )

    # Exactly one call — no retry.
    assert len(fake.calls) == 1


# --------------------------------------------------------------------------- #
# 6. Semantic equivalence: cached body contains the same segments as OFF body  #
# --------------------------------------------------------------------------- #


def test_cached_body_contains_same_segments_as_off_body(monkeypatch):
    refs = [{"title": "Guide", "content": "Reference guide body. " * 200, "key": "k1"}]

    # OFF body (flat).
    _off_env(monkeypatch)
    fake_off = _install_fake_client(monkeypatch, _canned())
    structured_off = _build(monkeypatch, refs=refs, focus={0})
    handler.invoke_bedrock_cached(structured_off, _CONFIG, max_tokens=512, workload="feedback_primary")
    off_body = json.loads(fake_off.calls[0]["body"])
    off_text = off_body["system"] + "\n" + off_body["messages"][0]["content"]

    # Cached body (content blocks).
    _explicit_env(monkeypatch)
    fake_cached = _install_fake_client(monkeypatch, _canned())
    structured_cached = _build(monkeypatch, refs=refs, focus={0})
    handler.invoke_bedrock_cached(structured_cached, _CONFIG, max_tokens=512, workload="feedback_primary")
    cached_body = json.loads(fake_cached.calls[0]["body"])
    cached_text = cached_body["system"] + "\n" + "\n".join(
        b["text"] for b in cached_body["messages"][0]["content"]
    )

    # Every semantic segment present in OFF is present in the cached body.
    for needle in (
        "SYSTEM INSTRUCTIONS",              # scaffolding
        "Document-Type configuration",      # stable config
        "Legal Memo",                       # doc-type name
        "FOCUS DIRECTIVE",                  # dynamic directive
        "INLINE DENSITY CAP",               # dynamic directive
        "REFERENCE MATERIAL: Guide",        # reference block label
        "SUBMITTED DOCUMENT",               # student block
        "Submitted content (UNTRUSTED DATA", # student framing
    ):
        assert needle in off_text, f"missing from OFF body: {needle!r}"
        assert needle in cached_text, f"missing from cached body: {needle!r}"


# --------------------------------------------------------------------------- #
# 7. Bug 1 — cross-job trusted-prefix stability (the core proof)               #
# --------------------------------------------------------------------------- #


def _cached_trusted_prefix_bytes(monkeypatch, *, refs, draft_text, boundary):
    """Return the checkpointed trusted-prefix bytes (system + trusted blocks up
    to and including the checkpoint) for a cached feedback-primary request.

    The boundary token is pinned PER CALL so that if the trusted prefix wrongly
    depended on the random token, two calls with DIFFERENT pinned tokens would
    diverge — exactly the Bug 1 regression we are guarding against.
    """
    _explicit_env(monkeypatch)
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: boundary)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = handler.build_structured_prompt(
        _base_config(), _DOC_TYPE_META, "Department instructions here.",
        [{"text": draft_text}], refs,
    )
    handler.invoke_bedrock_cached(
        structured, _CONFIG, max_tokens=512, workload="feedback_primary"
    )
    body = json.loads(fake.calls[0]["body"])
    content = body["messages"][0]["content"]
    marked = [i for i, b in enumerate(content) if "cache_control" in b][0]
    # System text + every trusted block up to and including the checkpoint.
    prefix_blocks = [b["text"] for b in content[: marked + 1]]
    return body["system"] + "\n\n" + "\n".join(prefix_blocks)


def test_cross_job_trusted_prefix_is_byte_stable_across_different_drafts(monkeypatch):
    """CORE Bug 1 proof: same config + references but DIFFERENT student drafts
    (and different per-assembly random tokens) produce the SAME checkpointed
    trusted-prefix bytes, so Anthropic's exact-prefix match can reuse across jobs.
    """
    refs = [
        {"title": "A", "content": "Alpha reference body. " * 200, "key": "doc/a.txt"},
        {"title": "B", "content": "Bravo reference body. " * 200, "key": "doc/b.txt"},
    ]

    prefix_job1 = _cached_trusted_prefix_bytes(
        monkeypatch, refs=refs, draft_text="First student draft.", boundary="TOKEN-JOB-1"
    )
    prefix_job2 = _cached_trusted_prefix_bytes(
        monkeypatch, refs=refs, draft_text="A totally different second draft!",
        boundary="TOKEN-JOB-2",
    )

    assert prefix_job1 == prefix_job2
    # And the stable trusted prefix must NOT contain the random boundary token
    # of EITHER job (proves the reference region is not wrapped by it).
    assert "TOKEN-JOB-1" not in prefix_job1
    assert "TOKEN-JOB-2" not in prefix_job2
    # It DOES carry the stable trusted-reference delimiter instead.
    assert "BEGIN TRUSTED REFERENCE DATA" in prefix_job1


def test_reference_change_does_change_trusted_prefix(monkeypatch):
    """A change to reference content changes the trusted prefix (cache must miss)."""
    refs = [{"title": "A", "content": "Alpha " * 300, "key": "doc/a.txt"}]
    refs_edited = [{"title": "A", "content": "Alpha EDITED " * 300, "key": "doc/a.txt"}]
    p1 = _cached_trusted_prefix_bytes(
        monkeypatch, refs=refs, draft_text="d", boundary="T"
    )
    p2 = _cached_trusted_prefix_bytes(
        monkeypatch, refs=refs_edited, draft_text="d", boundary="T"
    )
    assert p1 != p2


def test_reference_reorder_in_s3_does_not_change_trusted_prefix(monkeypatch):
    """Reordering the S3 listing does NOT change the trusted prefix (canonical
    ordering by key already sorts references before capping)."""
    refs = [
        {"title": "A", "content": "Alpha " * 200, "key": "doc/a.txt"},
        {"title": "B", "content": "Bravo " * 200, "key": "doc/b.txt"},
        {"title": "C", "content": "Charlie " * 200, "key": "doc/c.txt"},
    ]
    refs_shuffled = [refs[2], refs[0], refs[1]]
    p1 = _cached_trusted_prefix_bytes(
        monkeypatch, refs=refs, draft_text="d", boundary="T1"
    )
    p2 = _cached_trusted_prefix_bytes(
        monkeypatch, refs=refs_shuffled, draft_text="d", boundary="T2"
    )
    assert p1 == p2


def test_student_blocks_use_random_token_that_differs_across_assemblies(monkeypatch):
    """Property 12 preserved: student content is still wrapped by the RANDOM
    per-assembly token, which differs across assemblies."""
    refs = [{"title": "A", "content": "Alpha " * 300, "key": "doc/a.txt"}]

    _explicit_env(monkeypatch)
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "RANDTOK-1")
    fake1 = _install_fake_client(monkeypatch, _canned())
    s1 = handler.build_structured_prompt(
        _base_config(), _DOC_TYPE_META, "Dept.", [{"text": "draft"}], refs
    )
    handler.invoke_bedrock_cached(s1, _CONFIG, max_tokens=512, workload="feedback_primary")
    content1 = json.loads(fake1.calls[0]["body"])["messages"][0]["content"]
    student1 = [b["text"] for b in content1 if "SUBMITTED DOCUMENT" in b["text"]][0]

    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "RANDTOK-2")
    fake2 = _install_fake_client(monkeypatch, _canned())
    s2 = handler.build_structured_prompt(
        _base_config(), _DOC_TYPE_META, "Dept.", [{"text": "draft"}], refs
    )
    handler.invoke_bedrock_cached(s2, _CONFIG, max_tokens=512, workload="feedback_primary")
    content2 = json.loads(fake2.calls[0]["body"])["messages"][0]["content"]
    student2 = [b["text"] for b in content2 if "SUBMITTED DOCUMENT" in b["text"]][0]

    # Student block is wrapped by the RANDOM per-assembly token (differs).
    assert "BEGIN UNTRUSTED DATA [RANDTOK-1]" in student1
    assert "BEGIN UNTRUSTED DATA [RANDTOK-2]" in student2
    assert student1 != student2


# --------------------------------------------------------------------------- #
# 8. Bug 2 — no-optional-fields config: directive only after the checkpoint     #
# --------------------------------------------------------------------------- #


# A config with NO department/type/citation/restriction/notes text — the exact
# reachable shape that made the old fragile `replace(...)` match nothing, leaving
# the density cap inside (and duplicated after) the checkpointed trusted block.
def _no_optional_fields_config() -> dict[str, Any]:
    return {
        # No type_prompt_text, no structure_description (citation), no
        # restrictions_description, no notes_description, no tone_description.
        "tone": "supportive",
        "density": "medium",
    }


def _build_no_optional_fields(monkeypatch, *, refs):
    monkeypatch.setattr(prompt_assembly, "_generate_boundary_token", lambda: "FIXEDTOKEN")
    # Empty department prompt too, so type_instruction_parts is empty.
    return handler.build_structured_prompt(
        _no_optional_fields_config(),
        _DOC_TYPE_META,
        "",  # no department prompt
        _SEGMENTS,
        refs,
    )


def test_bug2_no_optional_fields_density_cap_only_after_checkpoint(monkeypatch):
    """Repro of Bug 2: with no optional fields, the per-submission density cap
    must appear ONLY in a post-checkpoint block — never in any trusted /
    checkpointed block — and must NOT be duplicated."""
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    # A large reference pushes the trusted prefix over the token floor so a
    # checkpoint is emitted even though the doc-type config is minimal.
    refs = [{"title": "A", "content": "Alpha reference body. " * 400, "key": "doc/a.txt"}]
    structured = _build_no_optional_fields(monkeypatch, refs=refs)

    handler.invoke_bedrock_cached(
        structured, _CONFIG, max_tokens=512, workload="feedback_primary"
    )

    body = json.loads(fake.calls[0]["body"])
    content = body["messages"][0]["content"]

    # A checkpoint IS emitted (large reference), on the last trusted block.
    marked = [i for i, b in enumerate(content) if "cache_control" in b]
    assert len(marked) == 1
    checkpoint_idx = marked[0]

    # The density cap appears EXACTLY ONCE across the whole request (not duplicated).
    density_hits = [i for i, b in enumerate(content) if "INLINE DENSITY CAP" in b["text"]]
    assert len(density_hits) == 1, "density cap should appear exactly once (not duplicated)"

    # ...and that single occurrence is AFTER the checkpoint (never inside a
    # trusted/checkpointed block).
    assert density_hits[0] > checkpoint_idx

    # No trusted/checkpointed block (index <= checkpoint) contains the density cap.
    for i in range(checkpoint_idx + 1):
        assert "INLINE DENSITY CAP" not in content[i]["text"]

    # The stable config block itself is directive-free.
    assert "INLINE DENSITY CAP" not in content[0]["text"]


def test_bug2_no_optional_fields_off_path_still_byte_identical(monkeypatch):
    """The no-optional-fields OFF-path render must still round-trip byte-for-byte
    through invoke_bedrock (the density cap stays embedded in place on OFF)."""
    _off_env(monkeypatch)
    refs = [{"title": "A", "content": "Alpha " * 100, "key": "doc/a.txt"}]
    structured = _build_no_optional_fields(monkeypatch, refs=refs)
    flat = structured.render()

    fake_a = _install_fake_client(monkeypatch, _canned())
    handler.invoke_bedrock_cached(structured, _CONFIG, max_tokens=512, workload="feedback_primary")
    body_cached_off = fake_a.calls[0]["body"]

    fake_b = _install_fake_client(monkeypatch, _canned())
    handler.invoke_bedrock(flat, _CONFIG, max_tokens=512, workload="feedback_primary")
    body_plain = fake_b.calls[0]["body"]

    assert body_cached_off == body_plain
    # On the OFF/flat render the density cap is present exactly once, embedded.
    assert flat.count("INLINE DENSITY CAP") == 1


def test_bug2_no_optional_fields_no_references_density_cap_only_after_checkpoint(monkeypatch):
    """With no optional fields AND no references, the real system scaffolding
    already exceeds the token floor, so a checkpoint is emitted on the stable
    config block. The density cap must still appear ONLY after the checkpoint and
    NOT be duplicated (the exact Bug 2 regression: the old code left it inside the
    stable config AND duplicated it after)."""
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build_no_optional_fields(monkeypatch, refs=[])

    handler.invoke_bedrock_cached(
        structured, _CONFIG, max_tokens=512, workload="feedback_primary"
    )

    body = json.loads(fake.calls[0]["body"])
    content = body["messages"][0]["content"]
    assert isinstance(content, list)

    marked = [i for i, b in enumerate(content) if "cache_control" in b]
    assert len(marked) == 1
    checkpoint_idx = marked[0]
    # No references → checkpoint is on the stable-config block (index 0).
    assert checkpoint_idx == 0

    # Density cap appears exactly once, AFTER the checkpoint (never inside it).
    density_hits = [i for i, b in enumerate(content) if "INLINE DENSITY CAP" in b["text"]]
    assert len(density_hits) == 1
    assert density_hits[0] > checkpoint_idx
    assert "INLINE DENSITY CAP" not in content[0]["text"]


# --------------------------------------------------------------------------- #
# 9. Bug 2 — defense-in-depth: a poisoned checkpoint falls back to plain        #
# --------------------------------------------------------------------------- #


def test_poisoned_checkpoint_falls_back_to_plain_path(monkeypatch):
    """If per-submission directive text somehow lands inside a trusted block, the
    request builder flags it and the caller falls back to the plain uncached path
    (never sends a poisoned checkpoint)."""
    _explicit_env(monkeypatch)
    fake = _install_fake_client(monkeypatch, _canned())
    structured = _build(monkeypatch, refs=[{"title": "A", "content": "Alpha " * 400, "key": "k"}])

    # Simulate contamination: force the stable config to contain the directive text.
    poisoned = handler.StructuredFeedbackPrompt(
        system_scaffolding=structured.system_scaffolding,
        stable_document_type_config=structured.stable_document_type_config
        + "\n\n" + structured.dynamic_directives,
        dynamic_directives=structured.dynamic_directives,
        reference_blocks=structured.reference_blocks,
        trusted_reference_blocks=structured.trusted_reference_blocks,
        student_blocks=structured.student_blocks,
        boundary_token=structured.boundary_token,
        document_type=structured.document_type,
        reference_content=structured.reference_content,
        student_content=structured.student_content,
        _user_message=structured._user_message,
        _legacy_string=structured._legacy_string,
    )

    handler.invoke_bedrock_cached(
        poisoned, _CONFIG, max_tokens=512, workload="feedback_primary"
    )

    # Fell back to the plain flat structure — no checkpoint sent.
    body = json.loads(fake.calls[0]["body"])
    assert isinstance(body["messages"][0]["content"], str)
    assert "cache_control" not in fake.calls[0]["body"]
