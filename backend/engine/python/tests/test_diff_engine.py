"""Example-based unit tests for the Diff Engine (Requirement 10 / REQ-DRAFT-DIFF-01).

Covers paragraph + intra-paragraph change detection (10.1), changed/added span
selection with a bounded context window that excludes unchanged spans (10.2),
the empty-change-set short-circuit on identical Drafts (10.4), and the prev->curr
index mapping that lets the Anchor Service re-map Anchors (10.5).

The Property 8 property-based test is task 8.2 and is intentionally NOT here.
"""
import pytest

from wren_engine import ChangeKind, DiffEngine, Segment, Span


def segs(*texts: str) -> list[Segment]:
    """Build an ordered Segment list with contiguous zero-based indices."""
    return [Segment(index=i, text=t) for i, t in enumerate(texts)]


# --------------------------------------------------------------------------- #
# Requirement 10.4 — identical Drafts yield an empty change set (short-circuit) #
# --------------------------------------------------------------------------- #

def test_identical_drafts_produce_empty_diff_and_no_llm_spans():
    engine = DiffEngine()
    draft = segs("The cat sat on the mat.", "It was a warm afternoon.")

    diff = engine.compute(draft, list(draft))

    assert diff.is_empty is True
    # Every paragraph classified UNCHANGED, and the change carries the mapping.
    assert all(c.kind is ChangeKind.UNCHANGED for c in diff.changes)
    assert [c.prev_index for c in diff.changes] == [0, 1]
    assert [c.curr_index for c in diff.changes] == [0, 1]
    # Nothing is sent to the LLM for unchanged content.
    assert engine.select_for_llm(diff, context_window=8) == []


def test_empty_to_empty_is_empty():
    engine = DiffEngine()
    diff = engine.compute([], [])
    assert diff.is_empty is True
    assert engine.select_for_llm(diff, context_window=5) == []


# --------------------------------------------------------------------------- #
# Requirement 10.1 / 10.2 — a purely ADDED paragraph                           #
# --------------------------------------------------------------------------- #

def test_added_paragraph_selects_whole_current_paragraph():
    engine = DiffEngine()
    prev = segs("First paragraph.")
    curr = segs("First paragraph.", "Brand new paragraph.")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    added = diff.added
    assert len(added) == 1
    assert added[0].kind is ChangeKind.ADDED
    assert added[0].prev_index is None
    assert added[0].curr_index == 1
    assert added[0].curr_text == "Brand new paragraph."

    # The whole current paragraph is selected; the unchanged paragraph 0 is not.
    spans = engine.select_for_llm(diff, context_window=8)
    assert spans == [Span(paragraph_index=1, start=0, end=len("Brand new paragraph."))]


# --------------------------------------------------------------------------- #
# Requirement 10.1 — a purely DELETED paragraph contributes no LLM span        #
# --------------------------------------------------------------------------- #

def test_deleted_paragraph_produces_deleted_change_and_no_span():
    engine = DiffEngine()
    prev = segs("Keep me.", "Delete me.")
    curr = segs("Keep me.")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    deleted = diff.deleted
    assert len(deleted) == 1
    assert deleted[0].kind is ChangeKind.DELETED
    assert deleted[0].prev_index == 1
    assert deleted[0].curr_index is None
    assert deleted[0].prev_text == "Delete me."

    # A removed paragraph has no current text to send to the LLM.
    assert engine.select_for_llm(diff, context_window=8) == []


# --------------------------------------------------------------------------- #
# Requirement 10.1 / 10.2 — an in-place edited paragraph                       #
# --------------------------------------------------------------------------- #

def test_changed_paragraph_reports_intra_paragraph_span_in_current_coords():
    engine = DiffEngine()
    prev = segs("Hello world")
    curr = segs("Hello brave world")

    diff = engine.compute(prev, curr)

    changed = diff.changed
    assert len(changed) == 1
    change = changed[0]
    assert change.kind is ChangeKind.CHANGED
    assert change.prev_index == 0
    assert change.curr_index == 0
    assert change.prev_text == "Hello world"
    assert change.curr_text == "Hello brave world"

    # One intra-paragraph changed span, in CURRENT coordinates, within bounds.
    assert len(change.changed_spans) == 1
    span = change.changed_spans[0]
    assert span.paragraph_index == 0
    assert 0 <= span.start <= span.end <= len(curr[0].text)
    # The inserted word falls inside the changed span.
    assert "brave" in curr[0].text[span.start:span.end]
    assert (span.start, span.end) == (6, 12)  # "brave "


def test_select_for_llm_expands_changed_span_by_bounded_context():
    engine = DiffEngine()
    curr_text = "Hello brave world"  # changed span [6, 12)
    diff = engine.compute(segs("Hello world"), segs(curr_text))

    window = 3
    spans = engine.select_for_llm(diff, context_window=window)

    assert len(spans) == 1
    span = spans[0]
    assert span.paragraph_index == 0
    # Context added on each side never exceeds `context_window` (bounding rule)...
    assert 6 - span.start <= window
    assert span.end - 12 <= window
    # ...and it clamps within the paragraph, never past its bounds.
    assert span.start >= 0
    assert span.end <= len(curr_text)
    assert (span.start, span.end) == (3, 15)


def test_select_for_llm_clamps_context_to_paragraph_length():
    engine = DiffEngine()
    curr_text = "Hello brave world"
    diff = engine.compute(segs("Hello world"), segs(curr_text))

    # A window larger than the paragraph must clamp to [0, len(text)].
    spans = engine.select_for_llm(diff, context_window=1000)

    assert spans == [Span(paragraph_index=0, start=0, end=len(curr_text))]


# --------------------------------------------------------------------------- #
# Requirement 10.2 — context bounding + merging of overlapping/adjacent spans  #
# --------------------------------------------------------------------------- #

def test_two_changes_stay_separate_under_small_context_window():
    engine = DiffEngine()
    # Two edits in one paragraph: changed spans [0,3) and [19,23).
    diff = engine.compute(
        segs("one two three four five"),
        segs("ONE two three four FIVE"),
    )

    spans = engine.select_for_llm(diff, context_window=2)

    # Far apart + small context => two distinct selected spans (no merge).
    assert spans == [
        Span(paragraph_index=0, start=0, end=5),
        Span(paragraph_index=0, start=17, end=23),
    ]


def test_overlapping_context_windows_merge_into_one_span():
    engine = DiffEngine()
    diff = engine.compute(
        segs("one two three four five"),
        segs("ONE two three four FIVE"),
    )

    # A large context window makes the two expanded spans overlap => merged.
    spans = engine.select_for_llm(diff, context_window=10)

    assert spans == [Span(paragraph_index=0, start=0, end=23)]


# --------------------------------------------------------------------------- #
# Requirement 10.5 — prev->curr mapping is preserved across shifts/reorders    #
# --------------------------------------------------------------------------- #

def test_insertion_shifts_following_paragraphs_and_preserves_mapping():
    engine = DiffEngine()
    prev = segs("Alpha.", "Beta.")
    curr = segs("Intro.", "Alpha.", "Beta.")

    diff = engine.compute(prev, curr)

    # Intro added at the top.
    assert [c.curr_index for c in diff.added] == [0]

    # Alpha/Beta are unchanged but shifted down by one: the prev->curr mapping
    # captured on each change is sufficient for anchor re-mapping (10.5).
    mapping = {
        c.prev_index: c.curr_index
        for c in diff.unchanged
    }
    assert mapping == {0: 1, 1: 2}

    # Only the added paragraph is sent to the LLM; shifted-but-unchanged excluded.
    spans = engine.select_for_llm(diff, context_window=4)
    assert spans == [Span(paragraph_index=0, start=0, end=len("Intro."))]


def test_reordering_preserves_prev_to_curr_mapping():
    engine = DiffEngine()
    prev = segs("Alpha.", "Beta.", "Gamma.")
    curr = segs("Gamma.", "Alpha.", "Beta.")

    diff = engine.compute(prev, curr)

    # The surviving Alpha/Beta block maps its prev indices to new positions.
    mapping = {c.prev_index: c.curr_index for c in diff.unchanged}
    assert mapping == {0: 1, 1: 2}
    # Gamma appears as added-at-front and removed-from-end (a move).
    assert [c.curr_index for c in diff.added] == [0]
    assert [c.prev_index for c in diff.deleted] == [2]


# --------------------------------------------------------------------------- #
# Requirement 10.2 — context_window bounds: zero works, negative is rejected   #
# --------------------------------------------------------------------------- #

def test_context_window_zero_returns_bare_changed_span():
    engine = DiffEngine()
    diff = engine.compute(segs("Hello world"), segs("Hello brave world"))

    spans = engine.select_for_llm(diff, context_window=0)

    # No context added: exactly the changed span [6, 12).
    assert spans == [Span(paragraph_index=0, start=6, end=12)]


def test_negative_context_window_raises_value_error():
    engine = DiffEngine()
    diff = engine.compute(segs("Hello world"), segs("Hello brave world"))

    with pytest.raises(ValueError, match="context_window"):
        engine.select_for_llm(diff, context_window=-1)
