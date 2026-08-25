# `wren_engine` — pure-logic Draft engine

Deterministic, dependency-free **Python 3.12** logic for WREN Writing Coach:
the **Diff Engine**, **Anchor Service**, **Progress Tracker**, prompt assembly,
and Bedrock invocation used by the Feedback Engine. Diff and anchor logic is
built on the standard library (`difflib`) and runs with no cloud calls.

Design reference: `docs/specs/wren-writing-coach/design.md` (Diff Engine, Anchor
Service, Progress Tracker); requirements: REQ-DRAFT-DIFF-01.

## Diff Engine (Requirement 10 / REQ-DRAFT-DIFF-01)

`DiffEngine` compares two consecutive Drafts (each a list of `Segment`
paragraphs) and drives cost-efficient feedback generation:

- `compute(prev, curr) -> Diff` — a paragraph-level alignment (via
  `difflib.SequenceMatcher`) classifies each paragraph as `UNCHANGED`,
  `CHANGED`, `ADDED`, or `DELETED`. Paragraphs edited in place also carry
  intra-paragraph `changed_spans` in **current** coordinates (Requirement 10.1).
  Each `ParagraphChange` records the prev→curr index mapping the Anchor Service
  needs to re-map Anchors across Drafts (Requirement 10.5).
- `select_for_llm(diff, context_window) -> list[Span]` — returns only the
  changed and added spans, each expanded by up to `context_window` characters on
  either side **within its own paragraph** (clamped to the paragraph length),
  and **excludes** unchanged spans. Overlapping/adjacent spans in the same
  paragraph are merged (Requirement 10.2).
- Identical Drafts produce a `Diff` whose `is_empty` is `True`, and
  `select_for_llm` returns `[]`, so the Feedback Engine is not invoked for
  unchanged content (Requirement 10.4).

```python
from wren_engine import DiffEngine, Segment

prev = [Segment(0, "The cat sat."), Segment(1, "It was warm.")]
curr = [Segment(0, "The cat sat on the mat."), Segment(1, "It was warm.")]

diff = DiffEngine().compute(prev, curr)
diff.is_empty            # False
spans = DiffEngine().select_for_llm(diff, context_window=8)
# -> [Span(paragraph_index=0, start=..., end=...)]  # changed region + context
```

## Anchor Service (Requirement 9 / REQ-ANCHOR-01)

`AnchorService` re-maps each Feedback Item's `Anchor` from the previous Draft to
the new Draft using the `Diff`, so prior feedback stays attached to the right
text after a revision — and is marked `removed` rather than mis-attached when it
can't be confidently placed.

- Each `Anchor` stores its `paragraph_index`, `start_offset`, `end_offset`, a
  `content_fingerprint` (normalized-text hash + bounded surrounding context),
  and a `state` (`active` | `removed`), mirroring the design "Anchor" entity
  (Requirement 9.1, 9.4). `compute_fingerprint(text, start, end)` is the single
  fingerprint function used both to create an Anchor (`Anchor.create(...)`) and
  to re-map it, so anchoring and re-mapping stay consistent.
- `remap(anchors, diff) -> list[RemapResult]` returns, per Anchor, either
  `Remapped(anchor', span)` — the updated Anchor (shifted paragraph index /
  offsets, refreshed fingerprint) plus its current-coords `Span` — or
  `Removed(anchor)` with `state = removed`.
- Confidence heuristic (confident vs. ambiguous / rewritten-beyond-recognition):
  - **UNCHANGED** paragraph → offsets preserved, paragraph index shifted to its
    new position; the fingerprint is re-confirmed (Requirement 9.3).
  - **CHANGED** paragraph → the original anchored substring (recovered from the
    diff's `prev_text`) is searched verbatim in the new paragraph: exactly one
    occurrence → confident re-map with shifted offsets (9.3); several
    occurrences → the bounded context disambiguates, else `removed` (9.5); zero
    occurrences → rewritten beyond recognition → `removed` (9.2, 9.5).
  - **DELETED** paragraph → `removed` (Requirement 9.4).

```python
from wren_engine import Anchor, AnchorService, DiffEngine, Remapped, Segment

prev = [Segment(0, "The cat sat on the mat."), Segment(1, "It was a warm afternoon.")]
curr = [Segment(0, "Intro."), Segment(1, "The cat sat on the mat."), Segment(2, "It was a warm afternoon.")]

anchor = Anchor.create(prev[1].text, paragraph_index=1, start_offset=9, end_offset=13)  # "warm"
diff = DiffEngine().compute(prev, curr)
[result] = AnchorService().remap([anchor], diff)
isinstance(result, Remapped)          # True — association preserved
result.anchor.paragraph_index         # 2 — shifted down by the inserted paragraph
```

The Anchor types (`Anchor`, `ContentFingerprint`, `AnchorState`, `Remapped`,
`Removed`, `RemapResult`) live in `wren_engine.anchor_service`, not `models.py`:
`models.py` is the shared *diff* vocabulary consumed by both engines, while the
Anchor types are specific to this service and build on that vocabulary.

## Shared model vocabulary

`wren_engine.models` defines the dataclasses shared across the engine:
`Segment`, `Span`, `ParagraphChange`, `Diff`, and the `ChangeKind` enum.
`Segment` mirrors the TypeScript `@wren/types` `Segment` (`{ index, text }`) so
the Node Document Service and this engine agree on the paragraph substrate.
These types are consumed by both the LLM-selection step and the Anchor Service.

## Dependencies

The engine core has **zero third-party runtime dependencies** — nothing is
bundled into a Lambda layer. `requirements.in` / `requirements.txt` pin the
**test-only** toolchain (pytest + Hypothesis per the UBC CIC Python testing
steering). Regenerate the pinning with uv when available:

```bash
uv pip compile backend/engine/python/requirements.in -o backend/engine/python/requirements.txt
```

The **Feedback Engine**'s model-invocation path (`wren_engine/model_invocation.py`,
below) is the one exception: it is a Python 3.12 **container** Lambda with a
heavier runtime dependency (`langchain-aws`), pinned separately in
`requirements-feedback-engine.in` / `.txt` so it is never bundled into the
lightweight Diff/Anchor/Progress Lambda(s).

## Feedback Engine building blocks (Task 9, design.md "Feedback Engine (Python 3.12, container Lambda)")

### Prompt assembly (Requirement 25.5 / REQ-PROMPT-DOCTYPE-01, Requirement 32.8 /
REQ-PROMPT-EDIT-01, Requirement 38 / REQ-SEC-PROMPTINJECT-01)

`wren_engine.prompt_assembly.PromptAssembler` composes a model prompt in three
layers, pure and dependency-free (no cloud calls):

1. `SystemScaffolding` (outer, authoritative, Technical-Admin-owned) — cross-type
   instructions, output schema, no-ghostwriting guardrail text.
2. `DocumentTypePromptConfig` (inner, Department-Admin-owned) — taxonomy, tone,
   density, category priority, type instructions, reference-grounding notes.
3. `UntrustedContent` (submitted text / Reference Material) — rendered ONLY
   inside a randomized-boundary-delimited data block in the user message,
   never in the system message, so embedded instructions cannot override the
   system layer or the guardrail (REQ-SEC-PROMPTINJECT-01).

```python
from wren_engine import DocumentTypePromptConfig, PromptAssembler, SystemScaffolding, UntrustedContent

scaffolding = SystemScaffolding(
    core_instructions="Provide Socratic feedback only; never rewrite the text.",
    output_schema_text="Return {category, question, anchor?, citation?}.",
    guardrail_text="Never emit replacement prose or a corrected version.",
)
document_type = DocumentTypePromptConfig(
    document_type_name="Legal Memo",
    category_names=("Citation Form", "Argument Structure"),
    tone="formal",
    density="medium",
)
submitted = UntrustedContent(label="SUBMITTED DOCUMENT", text="<student's draft text>")

prompt = PromptAssembler().assemble(scaffolding, document_type, [submitted])
prompt.system_message   # ONLY scaffolding content — never Document-Type or untrusted data
prompt.user_message     # Document-Type layer + delimited untrusted-data block(s)
```

### Model invocation (Requirement 51 / REQ-NFR-MODEL-01)

`wren_engine.model_invocation.LangChainBedrockInvoker` invokes the configured
Bedrock model via `langchain-aws`'s `ChatBedrockConverse` — model-agnostic, so
changing the configured model id is a configuration edit only:

```python
from wren_engine import LangChainBedrockInvoker, resolve_bedrock_model_id

# model id resolved from BEDROCK_MODEL_ID env var, falling back to the SSM
# parameter /${STACK_PREFIX}/config/bedrock-model-id — never hardcoded.
invoker = LangChainBedrockInvoker(model_id=resolve_bedrock_model_id())
reply = invoker.invoke(prompt)   # prompt: AssembledPrompt from PromptAssembler
reply.text
```

`ModelInvoker` (a `Protocol`, mirroring `SpanJudge` in `progress_tracker.py`)
is the injected boundary Feedback Engine orchestration logic depends on, so it
stays testable without a real Bedrock call.

## Test

```bash
uv run pytest backend/engine/python -q   # from the repo root
```
