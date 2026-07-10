"""Property-based test for the Progress Tracker — Property 17 (resolution
history accumulation).

Feature: wren-writing-coach, Property 17: Resolution history accumulation

Design (design.md "Property 17: Resolution history accumulation"):
  *For any* sequence of Drafts, the resolution history gains one entry per
  (Feedback Item, Draft) re-evaluation and never alters previously recorded
  entries.

Validates: Requirements 17.6 (REQ-RESOLUTION-01 criterion 6)
  17.6 — persist the Resolution Status history per Feedback Item across
         Drafts (append-only; prior entries are never mutated, reordered, or
         dropped).

Strategy
--------
Drives `ResolutionHistory.record` — the ONLY production mutator of resolution
history (`design.md` "ResolutionStatusHistory" entity: append-only per
`(feedbackItemId, draftId)`) — across an arbitrary sequence of synthetic
"Draft re-evaluations", each a list of `(item_id, category_id, status)` tuples
drawn from Hypothesis, deliberately WITHOUT invoking the Diff/Anchor engine:
Property 16 (task 8.7) already covers producing correct per-Draft
`ResolutionUpdate`s from a real Diff; this property is specifically about
history ACCUMULATION being append-only and faithful once updates exist, so
feeding hand-built `ResolutionUpdate` sequences directly isolates that
guarantee from Diff/Anchor correctness (matching how `test_progress_tracker.py`
already unit-tests one linear "v1 -> v2" case; this property generalizes to
arbitrary-length, arbitrary-content sequences with >=100 Hypothesis examples).

For each generated sequence of per-Draft update-lists, folding `record` across
the whole sequence must satisfy, at every step ``k``:

1. **Monotonic growth** — the number of entries after step ``k`` equals the
   sum of the update-list lengths seen so far (nothing lost, nothing merged
   away, nothing spuriously duplicated).
2. **Immutability / non-mutation of prior entries** — the entries recorded for
   steps ``0..k-1`` are BYTE-IDENTICAL (same tuples, same order) in the
   snapshot after step ``k`` as they were in the snapshot immediately after
   step ``k-1`` was first recorded; and the pre-``record`` history object
   itself is never mutated by a later `record` call (calling `record` returns
   a NEW `ResolutionHistory`, per the class's own append-only contract).
3. **One entry per (item, Draft) re-evaluation** — every entry appended at
   step ``k`` carries exactly the `draft_version` passed to that `record` call,
   and there is exactly one entry per input `(item_id, category_id, status)`
   tuple at that step (no fan-out, no drops).
4. **draft_versions reflects exactly the distinct versions recorded so far**,
   in ascending order, regardless of the order `record` calls arrived in
   (Hypothesis may generate an out-of-chronological-order version sequence;
   the history is a pure log and does not require monotonically increasing
   version numbers to remain correct, only to append-and-preserve).

Edge cases exercised (per the design's Testing Strategy generator guidance):
empty per-Draft update lists, a single Draft, many Drafts, repeated
`(item_id, category_id)` pairs recurring across Drafts with different
statuses, and duplicate `draft_version` values reused across separate
`record` calls (still must append, never overwrite).
"""
from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wren_engine import ResolutionEntry, ResolutionHistory, ResolutionStatus, ResolutionUpdate
from wren_testing import wren_settings

_STATUSES = st.sampled_from(list(ResolutionStatus))

# Small, collision-prone id vocabularies so the same (item_id, category_id)
# pair plausibly recurs across generated Drafts, exercising accumulation over
# a genuinely recurring Feedback Item rather than only ever-distinct ids.
_ITEM_IDS = st.sampled_from([f"item-{i}" for i in range(4)])
_CATEGORY_IDS = st.sampled_from(["clarity", "grammar", "structure"])

_update = st.builds(
    ResolutionUpdate,
    item_id=_ITEM_IDS,
    category_id=_CATEGORY_IDS,
    status=_STATUSES,
)

#: One (draft_version, updates-for-that-Draft) step. `draft_version` is drawn
#: independently per step (not forced to increase) so the test also covers
#: out-of-order / repeated version numbers (the history is an append-only log,
#: not a version-indexed map).
_step = st.tuples(
    st.integers(min_value=1, max_value=6),
    st.lists(_update, min_size=0, max_size=4),
)

_step_sequence = st.lists(_step, min_size=0, max_size=8)


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_step_sequence)
def test_resolution_history_accumulation(steps) -> None:
    # Feature: wren-writing-coach, Property 17: Resolution history accumulation
    # Validates: Requirements 17.6
    history = ResolutionHistory()
    snapshots: list[tuple[ResolutionEntry, ...]] = [history.entries]

    running_total = 0
    for draft_version, updates in steps:
        prior_history = history
        prior_entries = prior_history.entries

        new_history = prior_history.record(draft_version, updates)

        # --- Invariant 2a: `record` never mutates the object it was called on.
        assert prior_history.entries == prior_entries
        assert prior_history.entries == snapshots[-1]

        # --- Invariant 2b: every previously recorded entry is preserved,
        # byte-identical and in the same order, as a PREFIX of the new history.
        assert new_history.entries[: len(prior_entries)] == prior_entries

        # --- Invariant 1 / 3: exactly one new entry per input update, each
        # tagged with exactly this call's draft_version.
        appended = new_history.entries[len(prior_entries):]
        assert len(appended) == len(updates)
        for entry, update in zip(appended, updates):
            assert entry.item_id == update.item_id
            assert entry.category_id == update.category_id
            assert entry.status == update.status
            assert entry.draft_version == draft_version

        running_total += len(updates)
        assert len(new_history.entries) == running_total

        history = new_history
        snapshots.append(history.entries)

    # --- Invariant 4: draft_versions is exactly the distinct versions that
    # have at least one recorded entry, in ascending order — independent of
    # arrival order. `draft_versions` is derived solely from
    # `{e.draft_version for e in self.entries}` (see the class docstring), so
    # a `record(version, [])` call with an empty update list contributes NO
    # entries and therefore does NOT make `version` appear here, even though
    # `record` was called with it.
    expected_versions = tuple(sorted({dv for dv, updates in steps if updates}))
    assert history.draft_versions == expected_versions

    # --- Final sanity: folding via `record` end-to-end matches folding via
    # repeated `append` of individually-built entries (two independent routes
    # to the same log must agree), reinforcing that `record` is not doing
    # anything beyond "append one entry per update, tagged with draft_version".
    rebuilt = ResolutionHistory()
    for draft_version, updates in steps:
        for update in updates:
            rebuilt = rebuilt.append(
                ResolutionEntry(
                    item_id=update.item_id,
                    category_id=update.category_id,
                    draft_version=draft_version,
                    status=update.status,
                )
            )
    assert rebuilt.entries == history.entries


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_step_sequence)
def test_append_alone_is_also_non_mutating_and_order_preserving(steps) -> None:
    # Feature: wren-writing-coach, Property 17: Resolution history accumulation
    # Validates: Requirements 17.6
    #
    # `append` is `record`'s single-entry primitive (per the class docstring:
    # "record and append return a NEW history ... existing entries plus the
    # new ones"). This exercises the same non-mutation / order-preservation
    # invariants directly against `append`, so the property covers BOTH
    # production entry points into the append-only log, not only the
    # higher-level `record` convenience.
    history = ResolutionHistory()
    for draft_version, updates in steps:
        for update in updates:
            entry = ResolutionEntry(
                item_id=update.item_id,
                category_id=update.category_id,
                draft_version=draft_version,
                status=update.status,
            )
            prior_entries = history.entries
            new_history = history.append(entry)

            assert history.entries == prior_entries  # no mutation of the old object
            assert new_history.entries == prior_entries + (entry,)  # exact append
            history = new_history
