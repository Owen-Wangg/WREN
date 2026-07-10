"""Property-based test for the Progress Tracker — Property 18 (pattern
acknowledgment gating).

Feature: wren-writing-coach, Property 18: Pattern acknowledgment gating

Design (design.md "Property 18: Pattern acknowledgment gating"):
  *For any* Draft history, pattern-level acknowledgments are surfaced iff at
  least two Drafts exist; a recurring error category across drafts is
  surfaced with a tendency label (improving, persistent, or emerging), and
  with fewer than two Drafts no pattern-level claim is made.

Validates: Requirements 18.2, 18.5 (REQ-PROGRESS-ACK-01)
  18.2 — recognize recurring patterns across TWO OR MORE Drafts and surface
         pattern-level acknowledgment (improving, persistent, or newly
         emerging tendencies).
  18.5 — WHERE fewer than two Drafts exist, omit pattern-level claims and
         present only current-Draft feedback (no `PatternAck` is produced).

Strategy
--------
Builds an arbitrary resolution history as a sequence of "Draft snapshots" — for
each of several categories, an open-item count (0, 1, or 2+) is drawn per
Draft, and that many `STILL_UNRESOLVED` entries (plus the rest `RESOLVED`, to
keep the category present without being open) are folded into a
`ResolutionHistory` via the real `ResolutionHistory.record` calls, exactly the
production path task 8.8 already verifies for the log itself. This isolates
`detect_patterns`'s CLASSIFICATION logic (given a history, what tendency does
each category get, and when is nothing said) from history accumulation,
mirroring how `test_progress_tracker.py`'s example tests already hand-check a
few illustrative sequences — this property generalizes that to arbitrary
per-category open-count trajectories with >=100 Hypothesis examples.

Universal invariants asserted for every example (matching `detect_patterns`'s
documented contract in `progress_tracker.py`, restated here as the property
under test rather than re-deriving the implementation):

1. **Gating (18.5)** — with 0 or 1 distinct Draft versions in the history,
   `detect_patterns` returns `[]`. No exceptions to this: no acknowledgment of
   any kind is ever produced from a single-Draft history, regardless of how
   many open items it contains.
2. **At most one acknowledgment per category** — `detect_patterns` never
   emits two `PatternAck`s for the same `category_id` (this is a
   representation invariant of the acknowledgment set REQ-PROGRESS-ACK-01
   requires: a writer is told ONE tendency per recurring issue, not several
   sometimes-conflicting ones).
3. **No numeric content anywhere in an acknowledgment (18.3, restated as a
   corollary)** — a `PatternAck`'s only fields are `category_id` and
   `tendency`, and `tendency` is always one of the three qualitative
   `PatternTendency` enum members — never a number, score, or comparison.
4. **Tendency correctness for two-or-more-Draft histories**, checked against
   an independent (test-only) re-derivation of the same open-item-count
   trajectory used to build the history:
   - a category whose open-item count strictly decreased from its first
     recorded Draft to the latest recorded Draft is acknowledged `IMPROVING`;
   - a category with a positive open-item count on BOTH its first and the
     latest recorded Draft, without decreasing, is acknowledged `PERSISTENT`;
   - a category that first appears (across the whole history) only on the
     latest Draft, with a positive open-item count there, is acknowledged
     `EMERGING`;
   - any other trajectory (e.g. resolved by its first appearance and never
     recurring, or first appearing on the latest Draft with zero open items)
     yields NO acknowledgment for that category.

Edge cases exercised: zero categories, a single Draft, many Drafts, a category
present in every Draft, a category appearing only in the latest Draft, and
categories that are fully resolved (open count 0 throughout).
"""
from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wren_engine import (
    PatternAck,
    PatternTendency,
    ProgressTracker,
    ResolutionHistory,
    ResolutionStatus,
    ResolutionUpdate,
)
from wren_testing import wren_settings

_CATEGORIES = ["clarity", "grammar", "structure", "citation"]

#: An "open-item count" per (category, Draft): 0 (fully resolved that Draft),
#: 1, or 2 (kept small — the tracker's classification only cares about
#: zero-vs-positive and the first-vs-latest comparison, not the exact count).
_open_count = st.integers(min_value=0, max_value=2)

#: For each category, a per-Draft presence+open-count trajectory across N
#: Drafts. `None` at a position means the category has no entries on that
#: Draft at all (letting "first appearance" vary per category, independent of
#: the overall Draft count).
def _trajectories(n_drafts: int):
    return st.fixed_dictionaries(
        {cat: st.lists(st.one_of(st.none(), _open_count), min_size=n_drafts, max_size=n_drafts) for cat in _CATEGORIES}
    )


@st.composite
def _history_scenario(draw: st.DrawFn):
    """Generate ``(history, trajectories, draft_versions)``.

    ``trajectories`` maps each category to a length-``n_drafts`` list whose
    entry at position ``i`` is ``None`` (absent that Draft) or an open-item
    count (0/1/2) for ``draft_versions[i]``. Draft versions are drawn as a
    strictly increasing sequence so "first" / "latest" are unambiguous, while
    still exercising 0, 1, and many-Draft histories.
    """
    n_drafts = draw(st.integers(min_value=0, max_value=5))
    draft_versions = tuple(range(1, n_drafts + 1))
    trajectories = draw(_trajectories(n_drafts))

    history = ResolutionHistory()
    for i, version in enumerate(draft_versions):
        # A sentinel entry recorded on EVERY Draft (in a category outside
        # `_CATEGORIES`) guarantees `history.draft_versions` — which is
        # derived solely from `{e.draft_version for e in self.entries}` —
        # equals exactly `draft_versions`, even on Drafts where every
        # `_CATEGORIES` category happens to be absent (`None`). Without this,
        # a Draft with zero updates never becomes a distinct entry in the
        # log at all, silently shrinking `history.draft_versions` below what
        # this test believes it generated, and desynchronizing the test's
        # own first/latest bookkeeping from the real implementation's.
        updates: list[ResolutionUpdate] = [
            ResolutionUpdate(f"keepalive-{i}", "_keepalive", ResolutionStatus.RESOLVED)
        ]
        for cat_idx, category in enumerate(_CATEGORIES):
            count = trajectories[category][i]
            if count is None:
                continue
            for j in range(count):
                updates.append(
                    ResolutionUpdate(f"{category}-open-{j}", category, ResolutionStatus.STILL_UNRESOLVED)
                )
            # Keep the category "present" even at open_count == 0 via one
            # resolved item, so absence vs. zero-open-but-present is a real
            # distinction the generator can produce.
            updates.append(
                ResolutionUpdate(f"{category}-resolved-{i}", category, ResolutionStatus.RESOLVED)
            )
        history = history.record(version, updates)

    return history, trajectories, draft_versions


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_history_scenario())
def test_pattern_acknowledgment_gating(scenario) -> None:
    # Feature: wren-writing-coach, Property 18: Pattern acknowledgment gating
    # Validates: Requirements 18.2, 18.5
    history, trajectories, draft_versions = scenario
    tracker = ProgressTracker()

    acks = tracker.detect_patterns(history)

    if len(draft_versions) < 2:
        # --- Invariant 1 (18.5): fewer than two Drafts -> no pattern claims,
        # regardless of how many open items exist.
        assert acks == []
        return

    # --- Invariant 2: at most one acknowledgment per category.
    ack_categories = [a.category_id for a in acks]
    assert len(ack_categories) == len(set(ack_categories))

    # --- Invariant 3: no numeric content — every ack is (category_id,
    # qualitative tendency) only, and the tendency is one of the three
    # PatternTendency members.
    for ack in acks:
        assert isinstance(ack, PatternAck)
        assert ack.tendency in {
            PatternTendency.IMPROVING,
            PatternTendency.PERSISTENT,
            PatternTendency.EMERGING,
        }

    by_category = {a.category_id: a.tendency for a in acks}
    latest_version_index = len(draft_versions) - 1

    for category in _CATEGORIES:
        traj = trajectories[category]
        present_indices = [i for i, v in enumerate(traj) if v is not None]

        if not present_indices:
            assert category not in by_category
            continue

        first_index = present_indices[0]
        first_count = traj[first_index]
        latest_count = traj[latest_version_index]

        if latest_count is None:
            # The category never appears on the latest Draft at all -> the
            # tracker's own first/latest comparison (keyed on the LATEST
            # overall Draft version, not this category's own last
            # appearance) sees an absence there. Per the implementation,
            # `_open_count` on an absent Draft is 0, so this degenerates to
            # the "resolved and never recurring" no-claim case UNLESS the
            # category's first appearance is itself later than every other
            # category's latest (impossible here since first_index refers to
            # this category's own trajectory) — assert conservatively that a
            # positive first_count with nothing on the latest Draft is never
            # classified as improving/persistent inconsistently: reuse the
            # tracker's own semantics by comparing against 0.
            latest_count = 0

        if first_index == latest_version_index:
            # First appearance IS the latest Draft: emerging iff it has open
            # items there, else no claim.
            if latest_count > 0:
                assert by_category.get(category) == PatternTendency.EMERGING
            else:
                assert category not in by_category
            continue

        if latest_count < first_count:
            assert by_category.get(category) == PatternTendency.IMPROVING
        elif first_count > 0 and latest_count > 0:
            assert by_category.get(category) == PatternTendency.PERSISTENT
        else:
            assert category not in by_category


@pytest.mark.property
@wren_settings(max_examples=200)
@given(st.integers(min_value=0, max_value=1))
def test_fewer_than_two_drafts_never_acknowledges_even_with_many_open_items(n_drafts) -> None:
    # Feature: wren-writing-coach, Property 18: Pattern acknowledgment gating
    # Validates: Requirements 18.5
    #
    # A focused restatement of invariant 1 that deliberately maximizes open
    # items on the single available Draft (rather than relying on the general
    # scenario generator to happen to produce a heavily-loaded single Draft),
    # confirming gating holds even under the most "pattern-suggestive" single
    # Draft possible.
    tracker = ProgressTracker()
    history = ResolutionHistory()
    if n_drafts == 1:
        updates = [
            ResolutionUpdate(f"item-{i}", category, ResolutionStatus.STILL_UNRESOLVED)
            for i, category in enumerate(_CATEGORIES)
            for _ in range(3)
        ]
        history = history.record(1, updates)

    assert tracker.detect_patterns(history) == []
