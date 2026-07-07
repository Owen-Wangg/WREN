# `wren_engine` — pure-logic Draft engine

Deterministic, dependency-free **Python 3.12** logic for WREN Writing Coach:
the **Diff Engine** (this task), plus the forthcoming **Anchor Service** and
**Progress Tracker**. Built entirely on the standard library (`difflib`), it runs
in-region with no cloud calls and no per-Draft cost.

Design reference: `design.md` "Diff Engine, Anchor Service, Progress Tracker
(Python 3.12)"; requirements: `requirements.md` Requirement 10 (REQ-DRAFT-DIFF-01).

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

## Test

```bash
uv run pytest backend/engine/python -q   # from the repo root
```
