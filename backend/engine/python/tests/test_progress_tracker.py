"""Example-based unit tests for the Progress Tracker (Requirement 17 /
REQ-RESOLUTION-01, Requirement 18 / REQ-PROGRESS-ACK-01).

Covers exactly-one Resolution Status per Feedback Item (17.1, 17.2), the
structural short-circuits that never invoke the model — `removed` anchors →
`removed` (17.3) and unchanged governing spans → `unchanged` (17.4) — the
diff-selected changed+context region handed to the injected judge for changed
spans (17.5), the append-only resolution history (17.6), and pattern detection
that runs only across >=2 Drafts (18.2, 18.5).

The Property 16/18 property-based tests are tasks 8.7 / 8.9 and are intentionally
NOT here. The judge is an injected stub — no real LLM is used — mirroring the
SpanJudge abstraction from the design so the logic stays pure and deterministic.
"""
from dataclasses import fields

import pytest

from wren_engine import (
    Anchor,
    ChangeKind,
    DiffEngine,
    FeedbackItem,
    JudgeInput,
    PatternAck,
    PatternTendency,
    ProgressTracker,
    Remapped,
    Removed,
    ResolutionEntry,
    ResolutionHistory,
    ResolutionStatus,
    ResolutionUpdate,
    Segment,
    Span,
)


# --------------------------------------------------------------------------- #
# Test helpers                                                                 #
# --------------------------------------------------------------------------- #

def segs(*texts: str) -> list[Segment]:
    """Build an ordered Segment list with contiguous zero-based indices."""
    return [Segment(index=i, text=t) for i, t in enumerate(texts)]


def remapped_item(
    item_id: str,
    category_id: str,
    paragraph_index: int,
    start: int,
    end: int,
    curr_text: str,
) -> FeedbackItem:
    """A FeedbackItem whose Anchor was confidently re-mapped to a current span."""
    anchor = Anchor.create(curr_text, paragraph_index, start, end, feedback_item_id=item_id)
    span = Span(paragraph_index=paragraph_index, start=start, end=end)
    return FeedbackItem(item_id=item_id, category_id=category_id, remap=Remapped(anchor=anchor, span=span))


def removed_item(
    item_id: str,
    category_id: str,
    paragraph_index: int = 0,
    start: int = 0,
    end: int = 1,
    prev_text: str = "x",
) -> FeedbackItem:
    """A FeedbackItem whose Anchor the Anchor Service marked `removed`."""
    anchor = Anchor.create(prev_text, paragraph_index, start, end, feedback_item_id=item_id)
    return FeedbackItem(item_id=item_id, category_id=category_id, remap=Removed(anchor=anchor))


class RecordingJudge:
    """An injected SpanJudge stub that records its inputs (no real LLM)."""

    def __init__(self, verdict: ResolutionStatus = ResolutionStatus.RESOLVED) -> None:
        self.verdict = verdict
        self.calls: list[JudgeInput] = []

    def __call__(self, judge_input: JudgeInput) -> ResolutionStatus:
        self.calls.append(judge_input)
        return self.verdict


def forbidden_judge(judge_input: JudgeInput) -> ResolutionStatus:
    """A judge that fails the test if it is ever invoked."""
    raise AssertionError("SpanJudge must not be called for this item")


# --------------------------------------------------------------------------- #
# Requirement 17.3 — `removed` anchor → `removed`, never invoking the judge     #
# --------------------------------------------------------------------------- #

def test_removed_anchor_resolves_to_removed_without_judge():
    tracker = ProgressTracker()
    diff = DiffEngine().compute(segs("Hello world"), segs("Hello brave world"))
    item = removed_item("i1", "clarity")

    updates = tracker.reevaluate([item], diff, forbidden_judge)

    assert len(updates) == 1
    assert updates[0].item_id == "i1"
    assert updates[0].status is ResolutionStatus.REMOVED


# --------------------------------------------------------------------------- #
# Requirement 17.4 — unchanged governing span → `unchanged`, no LLM call        #
# --------------------------------------------------------------------------- #

def test_unchanged_paragraph_resolves_to_unchanged_without_judge():
    tracker = ProgressTracker()
    curr = segs("Hello world", "Second paragraph.")
    diff = DiffEngine().compute(list(curr), list(curr))  # identical Drafts
    item = remapped_item("i1", "clarity", paragraph_index=0, start=0, end=5, curr_text="Hello world")

    updates = tracker.reevaluate([item], diff, forbidden_judge)

    assert updates[0].status is ResolutionStatus.UNCHANGED


def test_changed_paragraph_but_span_outside_changed_region_is_unchanged():
    tracker = ProgressTracker()
    # Only the leading "one" -> "ONE" changed at [0, 3); "five" at the end is untouched.
    prev = segs("one two three four five")
    curr = segs("ONE two three four five")
    diff = DiffEngine().compute(prev, curr)
    # Anchor governs "five" [19, 23), which does not overlap the changed span.
    item = remapped_item("i1", "style", paragraph_index=0, start=19, end=23, curr_text=curr[0].text)

    updates = tracker.reevaluate([item], diff, forbidden_judge)

    assert updates[0].status is ResolutionStatus.UNCHANGED


# --------------------------------------------------------------------------- #
# Requirement 17.5 — changed governing span → judge over diff-selected region   #
# --------------------------------------------------------------------------- #

def test_changed_span_invokes_judge_with_diff_selected_region():
    tracker = ProgressTracker()
    prev = segs("Hello world")
    curr = segs("Hello brave world")  # changed span [6, 12)
    diff = DiffEngine().compute(prev, curr)
    item = remapped_item("i1", "clarity", paragraph_index=0, start=6, end=12, curr_text=curr[0].text)

    judge = RecordingJudge(ResolutionStatus.RESOLVED)
    updates = tracker.reevaluate([item], diff, judge, context_window=3)

    assert updates[0].status is ResolutionStatus.RESOLVED
    # The judge was called exactly once, over the current paragraph, with the
    # diff-selected changed+context region (never the whole Draft, never empty).
    assert len(judge.calls) == 1
    call = judge.calls[0]
    assert call.item.item_id == "i1"
    assert call.paragraph_index == 0
    assert call.region_text
    assert call.region_text in curr[0].text
    assert "brave" in call.region_text


@pytest.mark.parametrize(
    "verdict",
    [
        ResolutionStatus.RESOLVED,
        ResolutionStatus.PARTIALLY_RESOLVED,
        ResolutionStatus.STILL_UNRESOLVED,
    ],
)
def test_changed_span_returns_the_judge_verdict(verdict: ResolutionStatus):
    tracker = ProgressTracker()
    diff = DiffEngine().compute(segs("Hello world"), segs("Hello brave world"))
    item = remapped_item("i1", "clarity", paragraph_index=0, start=6, end=12, curr_text="Hello brave world")

    updates = tracker.reevaluate([item], diff, RecordingJudge(verdict))

    assert updates[0].status is verdict


def test_judge_returning_structural_status_is_rejected():
    tracker = ProgressTracker()
    diff = DiffEngine().compute(segs("Hello world"), segs("Hello brave world"))
    item = remapped_item("i1", "clarity", paragraph_index=0, start=6, end=12, curr_text="Hello brave world")

    # `unchanged` / `removed` are structural decisions, never a model verdict.
    with pytest.raises(ValueError, match="SpanJudge returned"):
        tracker.reevaluate([item], diff, RecordingJudge(ResolutionStatus.UNCHANGED))


# --------------------------------------------------------------------------- #
# Requirement 17.1 / 17.2 — exactly one Resolution Status per Feedback Item      #
# --------------------------------------------------------------------------- #

def test_each_item_yields_exactly_one_update_across_mixed_statuses():
    tracker = ProgressTracker()
    prev = segs("Hello world", "Keep me steady.")
    curr = segs("Hello brave world", "Keep me steady.")  # p0 changed, p1 unchanged
    diff = DiffEngine().compute(prev, curr)

    changed = remapped_item("changed", "clarity", 0, 6, 12, curr[0].text)
    unchanged = remapped_item("unchanged", "style", 1, 0, 4, curr[1].text)
    gone = removed_item("gone", "grammar")

    judge = RecordingJudge(ResolutionStatus.PARTIALLY_RESOLVED)
    updates = tracker.reevaluate([changed, unchanged, gone], diff, judge)

    # One update per input item, order preserved, each a valid single status.
    assert [u.item_id for u in updates] == ["changed", "unchanged", "gone"]
    by_id = {u.item_id: u.status for u in updates}
    assert by_id["changed"] is ResolutionStatus.PARTIALLY_RESOLVED
    assert by_id["unchanged"] is ResolutionStatus.UNCHANGED
    assert by_id["gone"] is ResolutionStatus.REMOVED
    # Judge invoked only for the single changed item.
    assert len(judge.calls) == 1
    assert judge.calls[0].item.item_id == "changed"


# --------------------------------------------------------------------------- #
# Requirement 17.6 — append-only resolution history across Drafts               #
# --------------------------------------------------------------------------- #

def test_history_record_is_append_only_and_preserves_prior_entries():
    updates_v1 = [ResolutionUpdate("i1", "clarity", ResolutionStatus.STILL_UNRESOLVED)]
    updates_v2 = [ResolutionUpdate("i1", "clarity", ResolutionStatus.RESOLVED)]

    history = ResolutionHistory()
    history_v1 = history.record(1, updates_v1)
    history_v2 = history_v1.record(2, updates_v2)

    # Original histories are untouched (immutable, append-only).
    assert history.entries == ()
    assert len(history_v1.entries) == 1
    assert len(history_v2.entries) == 2
    # Chronological order and per-Draft status preserved.
    assert history_v2.entries[0] == ResolutionEntry("i1", "clarity", 1, ResolutionStatus.STILL_UNRESOLVED)
    assert history_v2.entries[1] == ResolutionEntry("i1", "clarity", 2, ResolutionStatus.RESOLVED)
    assert history_v2.draft_versions == (1, 2)


def test_history_append_returns_new_history():
    history = ResolutionHistory()
    entry = ResolutionEntry("i1", "clarity", 1, ResolutionStatus.RESOLVED)

    appended = history.append(entry)

    assert history.entries == ()
    assert appended.entries == (entry,)


# --------------------------------------------------------------------------- #
# Requirement 18.5 — fewer than two Drafts → no pattern claims                  #
# --------------------------------------------------------------------------- #

def test_no_pattern_claims_with_zero_drafts():
    assert ProgressTracker().detect_patterns(ResolutionHistory()) == []


def test_no_pattern_claims_with_a_single_draft():
    history = ResolutionHistory().record(
        1,
        [
            ResolutionUpdate("i1", "clarity", ResolutionStatus.STILL_UNRESOLVED),
            ResolutionUpdate("i2", "style", ResolutionStatus.PARTIALLY_RESOLVED),
        ],
    )

    assert ProgressTracker().detect_patterns(history) == []


# --------------------------------------------------------------------------- #
# Requirement 18.2 — improving / persistent / emerging across >=2 Drafts        #
# --------------------------------------------------------------------------- #

def test_detects_improving_persistent_and_emerging_tendencies():
    tracker = ProgressTracker()
    # Draft 1: "improving" has two open items; "persistent" has one open item.
    history = ResolutionHistory().record(
        1,
        [
            ResolutionUpdate("a1", "improving", ResolutionStatus.STILL_UNRESOLVED),
            ResolutionUpdate("a2", "improving", ResolutionStatus.STILL_UNRESOLVED),
            ResolutionUpdate("b1", "persistent", ResolutionStatus.STILL_UNRESOLVED),
        ],
    )
    # Draft 2: "improving" both resolved (open 2 -> 0); "persistent" still open;
    # "emerging" newly appears with an open item.
    history = history.record(
        2,
        [
            ResolutionUpdate("a1", "improving", ResolutionStatus.RESOLVED),
            ResolutionUpdate("a2", "improving", ResolutionStatus.RESOLVED),
            ResolutionUpdate("b1", "persistent", ResolutionStatus.STILL_UNRESOLVED),
            ResolutionUpdate("c1", "emerging", ResolutionStatus.STILL_UNRESOLVED),
        ],
    )

    acks = tracker.detect_patterns(history)

    # One ack per category, in ascending category order (deterministic).
    assert acks == [
        PatternAck("emerging", PatternTendency.EMERGING),
        PatternAck("improving", PatternTendency.IMPROVING),
        PatternAck("persistent", PatternTendency.PERSISTENT),
    ]


def test_emerging_category_with_no_open_items_makes_no_claim():
    tracker = ProgressTracker()
    history = ResolutionHistory().record(
        1, [ResolutionUpdate("a1", "clarity", ResolutionStatus.STILL_UNRESOLVED)]
    )
    # A category that first appears in the latest Draft already resolved.
    history = history.record(
        2,
        [
            ResolutionUpdate("a1", "clarity", ResolutionStatus.STILL_UNRESOLVED),
            ResolutionUpdate("z1", "resolved-on-arrival", ResolutionStatus.RESOLVED),
        ],
    )

    acks = tracker.detect_patterns(history)

    assert PatternTendency.EMERGING not in {a.tendency for a in acks}
    assert "resolved-on-arrival" not in {a.category_id for a in acks}


def test_pattern_ack_carries_no_numeric_score():
    tracker = ProgressTracker()
    history = ResolutionHistory().record(
        1, [ResolutionUpdate("b1", "persistent", ResolutionStatus.STILL_UNRESOLVED)]
    ).record(
        2, [ResolutionUpdate("b1", "persistent", ResolutionStatus.STILL_UNRESOLVED)]
    )

    acks = tracker.detect_patterns(history)

    assert acks == [PatternAck("persistent", PatternTendency.PERSISTENT)]
    # The acknowledgment exposes only a qualitative tendency, never a number.
    field_names = {f.name for f in fields(acks[0])}
    assert field_names == {"category_id", "tendency"}
