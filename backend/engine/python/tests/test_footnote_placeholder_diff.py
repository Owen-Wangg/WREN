"""Example-based tests: footnote-placeholder generator cases for the Diff
Engine (footnote-citation-support spec, Task 10.1).

Covers the two halves of the design's Property 14 invariant with concrete
cases: a paragraph whose ONLY change is to a footnote's body/citation attrs
(marker position and `[N]`/`[?]` placeholder text unchanged) is classified
UNCHANGED, while a paragraph whose placeholder text itself changes (a marker
added, removed, or its number changes) is classified CHANGED/ADDED/DELETED
accordingly.

By the time a footnote reaches the Diff_Engine, `tipTapContentToSegments`
(Node side, `@wren/types`) has already flattened it to a `[N]`/`[?]`
placeholder string within its containing paragraph's segment text — the
Diff_Engine itself has no footnote-specific code path; these are ordinary
`Segment` texts containing placeholder characters, exercised through the
EXISTING `DiffEngine.compute` untouched.

Validates: Requirements 7.2, 7.4

The Property 14 property-based test (Task 10.2) is a separate, optional
task and is intentionally NOT here.
"""
from wren_engine import ChangeKind, DiffEngine, Segment


def segs(*texts: str) -> list[Segment]:
    """Build an ordered Segment list with contiguous zero-based indices."""
    return [Segment(index=i, text=t) for i, t in enumerate(texts)]


# --------------------------------------------------------------------------- #
# Requirement 7.4 — footnote body/citation edits (marker unchanged) are        #
# invisible to the Diff_Engine, because the placeholder text is unchanged.     #
# --------------------------------------------------------------------------- #

def test_footnote_body_edit_with_unchanged_placeholder_is_unchanged():
    """A footnote body edit never touches the segment text (it was never
    included in it — `[N]` is all the segment ever carried), so the paragraph
    is UNCHANGED even though the "logical" footnote content changed."""
    engine = DiffEngine()
    prev = segs("See the holding below.[1]")
    curr = segs("See the holding below.[1]")  # Same placeholder, "body" changed off-segment.

    diff = engine.compute(prev, curr)

    assert diff.is_empty is True
    assert all(c.kind is ChangeKind.UNCHANGED for c in diff.changes)


def test_multiple_footnote_placeholders_unchanged_across_drafts():
    engine = DiffEngine()
    prev = segs("First claim.[1] Second claim.[2]")
    curr = segs("First claim.[1] Second claim.[2]")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is True


# --------------------------------------------------------------------------- #
# Requirement 7.2 — a placeholder text change (marker added/removed/renumbered)#
# marks the containing paragraph as changed.                                   #
# --------------------------------------------------------------------------- #

def test_adding_a_footnote_marker_marks_the_paragraph_changed():
    engine = DiffEngine()
    prev = segs("See the holding below.")
    curr = segs("See the holding below.[1]")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
    assert len(changed) == 1
    assert changed[0].curr_text == "See the holding below.[1]"


def test_removing_a_footnote_marker_marks_the_paragraph_changed():
    engine = DiffEngine()
    prev = segs("See the holding below.[1]")
    curr = segs("See the holding below.")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
    assert len(changed) == 1
    assert changed[0].curr_text == "See the holding below."


def test_renumbering_a_footnote_marker_marks_the_paragraph_changed():
    """Deleting an earlier footnote elsewhere in the document causes
    `renumberFootnotes` to shift this paragraph's marker from [2] to [1] —
    the placeholder text itself changed, so the paragraph IS marked changed
    even though nothing else in the sentence changed."""
    engine = DiffEngine()
    prev = segs("See the holding below.[2]")
    curr = segs("See the holding below.[1]")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
    assert len(changed) == 1


def test_malformed_placeholder_question_mark_is_ordinary_literal_text():
    """The `[?]` placeholder (missing/non-numeric footnoteNumber) is treated
    as literal text like any other — appearing/disappearing marks the
    paragraph changed, same as any `[N]` marker."""
    engine = DiffEngine()
    prev = segs("An orphaned reference.")
    curr = segs("An orphaned reference.[?]")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
    assert len(changed) == 1
    assert changed[0].curr_text == "An orphaned reference.[?]"


def test_only_prose_around_placeholder_changes_still_marks_changed():
    """A change to the SURROUNDING prose (not the placeholder) still marks
    the paragraph changed, as with any ordinary text edit — the placeholder
    is just literal text within the paragraph, not special-cased."""
    engine = DiffEngine()
    prev = segs("See the holding below.[1]")
    curr = segs("See the earlier holding below.[1]")

    diff = engine.compute(prev, curr)

    assert diff.is_empty is False
    changed = [c for c in diff.changes if c.kind is ChangeKind.CHANGED]
    assert len(changed) == 1
