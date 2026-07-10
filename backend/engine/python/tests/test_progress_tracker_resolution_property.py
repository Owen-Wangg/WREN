"""Property-based test for the Progress Tracker — Property 16 (resolution status
correctness).

Feature: wren-writing-coach, Property 16: Resolution status correctness

Design (design.md "Property 16: Resolution status correctness"):
  *For any* anchored Feedback Item re-evaluated against a new Draft, exactly one
  Resolution Status from `{resolved, partially_resolved, still_unresolved,
  removed, unchanged}` is assigned; an Item whose Anchor is `removed` maps to
  `removed`, and an Item over an unchanged span maps to `unchanged` without
  invoking the LLM judge. For structural (non-anchored) items, `removed` is
  never assigned; re-evaluation uses the full new Draft.

Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.7 (REQ-RESOLUTION-01)
  17.1 — re-evaluate each existing anchored Feedback Item and assign it exactly
         one Resolution Status from the five-member set.
  17.2 — tracked per Feedback Item, not per span (one status per item).
  17.3 — an Anchor the Anchor Service marked `removed` -> Resolution Status
         `removed`.
  17.4 — a span whose governing paragraph is unchanged -> `unchanged`, with NO
         model judgment (the judge is never invoked).
  17.7 — document-wide structural Feedback Items (no Anchor) are re-evaluated
         against the FULL new Draft rather than a Diff-selected span, and are
         restricted to `{resolved, partially_resolved, still_unresolved,
         unchanged}` — `removed` is never assigned, since `removed` is defined
         by Anchor re-mapping failure and a structural item has no Anchor to
         fail to re-map.

Strategy
--------
This test drives the REAL production flow — `DiffEngine().compute(...)` feeds
`ProgressTracker().reevaluate(...)` — rather than fabricating diffs, mirroring
`test_diff_engine_property.py` / `test_anchor_remap_property.py`. Each example
builds a small previous Draft from a collision-prone vocabulary and derives a
current Draft via keep / delete / edit-in-place / rewrite actions (reusing the
diff-engine property test's proven generator shape), then constructs anchored
Feedback Items in three structural categories that the Progress Tracker's own
logic (not the test) sorts into their resolution paths:

* **removed** — an Anchor the (real) Anchor Service marks `Removed` on this
  Diff (17.3).
* **unchanged-governing-span** — an Anchor `Remapped` onto a paragraph/void
  region the Diff reports as `UNCHANGED` (17.4).
* **changed-governing-span** — an Anchor `Remapped` onto a paragraph the Diff
  reports as `CHANGED`, overlapping a changed sub-span, so the (injected, never
  a real model) judge is invoked and its verdict becomes the item's status.

A second test targets 17.7's `removed`-exclusion directly against the judge
contract: a stub judge that attempts to return `removed` for a changed span is
either rejected outright by the tracker's `_JUDGMENT_STATUSES` guard, or never
reached at all — `removed` is never reachable via judge/model verdict, only via
Anchor re-mapping failure (see the scope note below for the boundary of what
this currently exercises).

The universal invariants asserted for every example:

1. Exactly one `ResolutionUpdate` per input item (17.1, 17.2).
2. `removed`-anchor items -> `ResolutionStatus.REMOVED`, and the judge is NEVER
   called for them (17.3).
3. Unchanged-governing-span items -> `ResolutionStatus.UNCHANGED`, and the judge
   is NEVER called for them (17.4).
4. Changed-governing-span items -> exactly the judge's verdict, and the judge
   IS called for them with the Diff-selected changed+context region (17.5,
   exercised here as a supporting invariant for the completeness of 17.1).
5. A judge that attempts to return `removed` for a changed span is rejected by
   the tracker (or never reached at all) — `removed` is never a legitimate
   judge/model verdict, since it is defined solely by Anchor re-mapping
   failure (REQ-ANCHOR-01) and a changed-but-remapped span, by construction,
   did not fail to re-map (17.7's "removed is never assigned outside Anchor
   re-mapping failure" restated against the actual `_JUDGMENT_STATUSES` guard).

Scope note on Requirement 17.7 (structural items)
---------------------------------------------------
17.7 additionally specifies re-evaluation for document-wide STRUCTURAL Feedback
Items (no Anchor, evaluated against the full new Draft). As of this test,
`ProgressTracker.reevaluate` has no distinct code path for structural items —
only anchored items flow through the Anchor Service's `RemapResult`. Invariant
5 above is the strongest statement this property test can make against the
CURRENT implementation (removed is unreachable via judge verdict); it does not
yet exercise a full-Draft, no-Anchor re-evaluation path, because no such path
exists in `progress_tracker.py` today. This should be revisited once task 9's
structural-feedback work adds that entry point.
"""
from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wren_engine import (
    Anchor,
    AnchorService,
    ChangeKind,
    DiffEngine,
    FeedbackItem,
    JudgeInput,
    ProgressTracker,
    Remapped,
    Removed,
    ResolutionStatus,
    Segment,
    Span,
)
from wren_testing import wren_settings

# Same deliberately small, collision-prone vocabulary used by the Diff Engine's
# own property test, so every paragraph-level change kind (unchanged / changed
# / added / deleted) shows up often across generated examples.
_WORDS = ["the", "cat", "dog", "sat", "ran", "fox", "red", "big", "law", "case"]
_MARKER = "ANCHORWORD"

_words = st.lists(st.sampled_from(_WORDS), min_size=1, max_size=5)

#: The three judge verdicts a SpanJudge is allowed to return (never a
#: structural status — that would be a contract violation the tracker rejects).
_JUDGE_VERDICTS = st.sampled_from(
    [
        ResolutionStatus.RESOLVED,
        ResolutionStatus.PARTIALLY_RESOLVED,
        ResolutionStatus.STILL_UNRESOLVED,
    ]
)


def _paragraph(words: list[str]) -> str:
    return " ".join(words)


def _segments(texts: list[str]) -> list[Segment]:
    return [Segment(index=k, text=t) for k, t in enumerate(texts)]


@st.composite
def _resolution_scenario(draw: st.DrawFn):
    """Generate ``(prev_texts, curr_texts, verdict)``.

    ``prev_texts`` carries a unique marker paragraph (for a confidently
    re-mappable/removable Anchor) plus filler paragraphs; ``curr_texts`` is
    derived by editing each paragraph independently (delete / keep / edit /
    rewrite), guaranteeing the Diff reports a genuine mix of change kinds
    without hand-authoring diffs. ``verdict`` is the (stubbed) judge's answer
    for any changed-span item in this example.
    """
    n_prev = draw(st.integers(min_value=1, max_value=4))
    marker_para = draw(st.integers(min_value=0, max_value=n_prev - 1))

    prev_texts: list[str] = []
    for pid in range(n_prev):
        prefix = draw(_words)
        if pid == marker_para:
            suffix = draw(_words)
            text = " ".join([f"para{pid}"] + prefix + [_MARKER] + suffix)
        else:
            text = " ".join([f"para{pid}"] + prefix)
        prev_texts.append(text)

    curr_texts: list[str] = []
    for pid, text in enumerate(prev_texts):
        action = draw(st.sampled_from(["keep", "delete", "edit", "rewrite"]))
        if action == "keep":
            curr_texts.append(text)
        elif action == "delete":
            pass
        elif action == "edit":
            curr_texts.append(f"{text} {draw(st.sampled_from(_WORDS))}")
        else:
            curr_texts.append(_paragraph([f"para{pid}fresh"] + draw(_words)))

    verdict = draw(_JUDGE_VERDICTS)
    return prev_texts, marker_para, curr_texts, verdict


class _StubJudge:
    """Injected SpanJudge stub (never a real model) recording invocation."""

    def __init__(self, verdict: ResolutionStatus) -> None:
        self.verdict = verdict
        self.called_with: list[JudgeInput] = []

    def __call__(self, judge_input: JudgeInput) -> ResolutionStatus:
        self.called_with.append(judge_input)
        return self.verdict


def _forbidden_judge(judge_input: JudgeInput) -> ResolutionStatus:
    raise AssertionError(
        "SpanJudge must not be invoked for a removed-anchor or unchanged-span item "
        "(Requirements 17.3, 17.4)"
    )


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_resolution_scenario())
def test_resolution_status_correctness(scenario) -> None:
    # Feature: wren-writing-coach, Property 16: Resolution status correctness
    # Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.7
    #
    # NOTE on 17.7 coverage: `ProgressTracker.reevaluate` (as implemented today)
    # only re-evaluates ANCHORED Feedback Items via the Anchor Service's
    # `RemapResult`. Document-wide STRUCTURAL items (no Anchor, re-evaluated
    # against the full new Draft) are not yet a distinct code path in
    # `progress_tracker.py` — there is no structural-item entry point to drive
    # from this test. The universal invariant this test CAN verify against the
    # real implementation is the one the current `_status_for` dispatch
    # actually encodes: `ResolutionStatus.REMOVED` is reachable ONLY through an
    # Anchor Service `Removed` result (never through a SpanJudge verdict, since
    # `_JUDGMENT_STATUSES` excludes it) — which is precisely 17.7's guarantee
    # restated from the code's own guard rather than a separate structural
    # code path. When task 9's structural-feedback work adds a document-wide
    # re-evaluation entry point, this test should gain a corresponding case
    # that drives it directly instead of relying on this restated guarantee.
    prev_texts, marker_para, curr_texts, verdict = scenario
    prev_segments = _segments(prev_texts)
    curr_segments = _segments(curr_texts)
    diff = DiffEngine().compute(prev_segments, curr_segments)

    marker_text = prev_texts[marker_para]
    start = marker_text.index(_MARKER)
    end = start + len(_MARKER)

    # --- Build one Anchor over the marker span and let the REAL Anchor
    # Service decide its fate on this Diff (Remapped or Removed) — the test
    # never hand-picks which bucket an item falls into. ----------------------
    anchor = Anchor.create(marker_text, marker_para, start, end, feedback_item_id="m1")
    [remap_result] = AnchorService().remap([anchor], diff)

    marker_item = FeedbackItem(item_id="m1", category_id="cat", remap=remap_result)

    tracker = ProgressTracker()

    if isinstance(remap_result, Removed):
        # --- Property 16 / 17.3: removed anchor -> REMOVED, judge never called.
        updates = tracker.reevaluate([marker_item], diff, _forbidden_judge)
        assert len(updates) == 1
        assert updates[0].item_id == "m1"
        assert updates[0].status is ResolutionStatus.REMOVED
        return

    assert isinstance(remap_result, Remapped)
    span = remap_result.span

    # Determine (independently of the tracker) whether this item's governing
    # span is changed in this Diff, using the same paragraph-level Diff facts a
    # correct re-implementation would use.
    curr_change = next(
        (c for c in diff.changes if c.curr_index == span.paragraph_index), None
    )
    governing_span_changed = curr_change is not None and curr_change.kind is ChangeKind.CHANGED and any(
        _overlaps(span, cs) for cs in curr_change.changed_spans
    )

    if not governing_span_changed:
        # --- Property 16 / 17.4: unchanged governing span -> UNCHANGED,
        # judge never called.
        updates = tracker.reevaluate([marker_item], diff, _forbidden_judge)
        assert len(updates) == 1
        assert updates[0].item_id == "m1"
        assert updates[0].status is ResolutionStatus.UNCHANGED
        return

    # --- Governing span changed: the judge IS invoked, and its verdict is
    # exactly the assigned status (supports 17.1's "exactly one status" over
    # the judged branch, and 17.5's "judge invoked for changed spans").
    judge = _StubJudge(verdict)
    updates = tracker.reevaluate([marker_item], diff, judge)
    assert len(updates) == 1
    assert updates[0].item_id == "m1"
    assert updates[0].status is verdict
    assert updates[0].status in {
        ResolutionStatus.RESOLVED,
        ResolutionStatus.PARTIALLY_RESOLVED,
        ResolutionStatus.STILL_UNRESOLVED,
    }
    assert len(judge.called_with) == 1


@pytest.mark.property
@wren_settings(max_examples=200)
@given(
    prev_text=st.text(
        alphabet=st.characters(min_codepoint=0x20, max_codepoint=0x2FF), min_size=0, max_size=40
    ),
    curr_text=st.text(
        alphabet=st.characters(min_codepoint=0x20, max_codepoint=0x2FF), min_size=1, max_size=40
    ),
)
def test_judge_may_never_return_removed_for_a_changed_span(prev_text, curr_text) -> None:
    # Feature: wren-writing-coach, Property 16: Resolution status correctness
    # Validates: Requirements 17.7
    #
    # `removed` is defined solely by Anchor re-mapping failure (REQ-ANCHOR-01)
    # and is therefore never a legitimate model/judge verdict for a changed
    # governing span — this is the concrete form 17.7's "removed is never
    # assigned to a no-Anchor-to-fail item" guarantee takes against the
    # ACTUAL implementation (`_JUDGMENT_STATUSES` excludes `REMOVED` and
    # `UNCHANGED`; `_status_for` raises if the judge returns either). Exercised
    # over arbitrary Unicode Draft text, including empty strings, per the
    # design's Testing Strategy edge-case guidance.
    if prev_text == curr_text:
        curr_text = curr_text + "\u200b"  # force a genuine change (zero-width space)

    prev_segments = _segments([prev_text]) if prev_text else _segments([""])
    curr_segments = _segments([curr_text])
    diff = DiffEngine().compute(prev_segments, curr_segments)

    # Anchor the whole (possibly empty) previous paragraph; whatever the Anchor
    # Service decides, we only proceed down the changed-span/judge path when it
    # remaps (Removed items are covered by the other test in this module).
    anchor = Anchor.create(prev_text, 0, 0, len(prev_text), feedback_item_id="s1")
    [remap_result] = AnchorService().remap([anchor], diff)
    if not isinstance(remap_result, Remapped):
        return  # Removed is asserted correct-by-construction elsewhere.

    item = FeedbackItem(item_id="s1", category_id="cat", remap=remap_result)
    tracker = ProgressTracker()

    judge = _StubJudge(ResolutionStatus.REMOVED)  # a judge attempting to lie
    try:
        updates = tracker.reevaluate([item], diff, judge)
    except ValueError:
        # The tracker rejected the illegal verdict outright — the strongest
        # possible enforcement of "removed is never a judge/model verdict".
        return

    # If no exception was raised, the span must not have reached the judge at
    # all (e.g. it resolved structurally to UNCHANGED) — in which case the
    # illegal verdict was never consulted, and the status is still never
    # REMOVED via this path.
    assert len(judge.called_with) == 0
    assert updates[0].status is not ResolutionStatus.REMOVED


def _overlaps(span: Span, other: Span) -> bool:
    """True when ``span`` overlaps ``other`` (half-open ranges; zero-width aware)."""
    if span.start == span.end:
        return other.start <= span.start <= other.end
    return span.start < other.end and other.start < span.end
