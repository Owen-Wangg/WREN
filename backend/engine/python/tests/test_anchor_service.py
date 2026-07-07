"""Example-based unit tests for the Anchor Service (Requirement 9 / REQ-ANCHOR-01).

Covers re-mapping an Anchor across Drafts using the computed Diff: preserving the
association on a confident (possibly shifted) match (9.1, 9.3), marking the Anchor
``removed`` when its text was deleted (9.4) or rewritten beyond recognition /
cannot be confidently matched (9.5), and never mis-attaching to unrelated text
(9.2). Also locks the fingerprint helper's identity behaviour (9.1).

The Property 6 (8.4) and Property 7 (8.5) property-based tests are separate tasks
and are intentionally NOT here.
"""
from wren_engine import (
    Anchor,
    AnchorService,
    AnchorState,
    ChangeKind,
    DiffEngine,
    Remapped,
    Removed,
    Segment,
    Span,
    compute_fingerprint,
)


def segs(*texts: str) -> list[Segment]:
    """Build an ordered Segment list with contiguous zero-based indices."""
    return [Segment(index=i, text=t) for i, t in enumerate(texts)]


# --------------------------------------------------------------------------- #
# Requirement 9.1 — the fingerprint helper's identity behaviour                #
# --------------------------------------------------------------------------- #

def test_fingerprint_is_stable_for_same_text_and_span():
    text = "It was a warm afternoon."
    fp1 = compute_fingerprint(text, 9, 13)  # "warm"
    fp2 = compute_fingerprint(text, 9, 13)
    assert fp1 == fp2
    assert fp1.matches(fp2)


def test_fingerprint_differs_for_materially_different_text():
    warm = compute_fingerprint("It was a warm afternoon.", 9, 13)  # "warm"
    cold = compute_fingerprint("It was a cold afternoon.", 9, 13)  # "cold"
    assert warm.text_hash != cold.text_hash
    assert not warm.matches(cold)


def test_fingerprint_normalizes_case_and_whitespace():
    # Case and internal whitespace differences alone do not change identity.
    a = compute_fingerprint("The CAT sat", 4, 7)  # "CAT"
    b = compute_fingerprint("the cat sat", 4, 7)  # "cat"
    assert a.matches(b)


# --------------------------------------------------------------------------- #
# Requirement 9.3 — surviving UNCHANGED paragraph, shifted position            #
# --------------------------------------------------------------------------- #

def test_unchanged_paragraph_shifted_down_preserves_association():
    engine = DiffEngine()
    prev = segs("The cat sat on the mat.", "It was a warm afternoon.")
    # Insert a paragraph above: the anchored paragraph shifts from index 1 to 2.
    curr = segs(
        "Intro paragraph.",
        "The cat sat on the mat.",
        "It was a warm afternoon.",
    )
    # Anchor over "warm" in the (unchanged) second paragraph.
    anchor = Anchor.create(prev[1].text, paragraph_index=1, start_offset=9, end_offset=13)

    diff = engine.compute(prev, curr)
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Remapped)
    # Paragraph index shifts to its new position; offsets are preserved (9.3).
    assert result.anchor.paragraph_index == 2
    assert (result.anchor.start_offset, result.anchor.end_offset) == (9, 13)
    assert result.anchor.state is AnchorState.ACTIVE
    assert result.span == Span(paragraph_index=2, start=9, end=13)
    # The association (feedback linkage + confirmed content) is carried forward.
    assert result.anchor.content_fingerprint.matches(anchor.content_fingerprint)


# --------------------------------------------------------------------------- #
# Requirement 9.3 — in-place edited paragraph where the anchored span survives #
# --------------------------------------------------------------------------- #

def test_changed_paragraph_relocates_surviving_span_with_shifted_offsets():
    engine = DiffEngine()
    prev = segs("Hello brave world")
    # An edit elsewhere in the paragraph pushes "brave" to a new offset.
    curr = segs("Well, Hello brave world")
    anchor = Anchor.create(prev[0].text, paragraph_index=0, start_offset=6, end_offset=11)  # "brave"

    diff = engine.compute(prev, curr)
    assert diff.changed  # sanity: this is an in-place edit, not add/delete
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Remapped)
    assert result.anchor.paragraph_index == 0
    # "brave" now lives at [12, 17) in the current paragraph.
    assert curr[0].text[result.anchor.start_offset:result.anchor.end_offset] == "brave"
    assert (result.anchor.start_offset, result.anchor.end_offset) == (12, 17)
    assert result.span == Span(paragraph_index=0, start=12, end=17)
    assert result.anchor.state is AnchorState.ACTIVE


# --------------------------------------------------------------------------- #
# Requirement 9.2 / 9.5 — rewritten beyond recognition → removed, never mis-attach
# --------------------------------------------------------------------------- #

def test_changed_paragraph_rewritten_beyond_recognition_is_removed():
    engine = DiffEngine()
    prev = segs("The plaintiff argued negligence.")
    curr = segs("The plaintiff argued breach of contract.")
    # Anchor over "negligence" — the exact text no longer exists in the new draft.
    start = prev[0].text.index("negligence")
    anchor = Anchor.create(
        prev[0].text, paragraph_index=0, start_offset=start, end_offset=start + len("negligence")
    )

    diff = engine.compute(prev, curr)
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Removed)
    assert result.anchor.state is AnchorState.REMOVED
    # Never mis-attached: a Removed result carries no current-draft span (9.2).
    assert not hasattr(result, "span")


# --------------------------------------------------------------------------- #
# Requirement 9.4 — deleted paragraph → removed                                #
# --------------------------------------------------------------------------- #

def test_deleted_paragraph_marks_anchor_removed():
    engine = DiffEngine()
    prev = segs("Keep me.", "Delete me entirely.")
    curr = segs("Keep me.")
    anchor = Anchor.create(prev[1].text, paragraph_index=1, start_offset=0, end_offset=6)  # "Delete"

    diff = engine.compute(prev, curr)
    assert diff.deleted  # sanity
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Removed)
    assert result.anchor.state is AnchorState.REMOVED


# --------------------------------------------------------------------------- #
# Requirement 9.2 / 9.5 — ambiguous match → removed rather than mis-attach     #
# --------------------------------------------------------------------------- #

def test_ambiguous_repeated_text_in_edited_paragraph_is_removed():
    engine = DiffEngine()
    prev = segs("The cat sat.")
    # The edited paragraph now contains the anchored text "cat" twice, and the
    # surrounding context of neither occurrence matches the original — the match
    # is ambiguous, so the Anchor is removed rather than mis-attached (9.2, 9.5).
    curr = segs("The cat ate. The cat slept.")
    start = prev[0].text.index("cat")
    anchor = Anchor.create(
        prev[0].text, paragraph_index=0, start_offset=start, end_offset=start + len("cat")
    )

    diff = engine.compute(prev, curr)
    assert diff.changed  # sanity: in-place edit
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Removed)
    assert result.anchor.state is AnchorState.REMOVED


# --------------------------------------------------------------------------- #
# Requirement 9.1 — mixed batch: each Anchor is re-mapped independently        #
# --------------------------------------------------------------------------- #

def test_remap_processes_each_anchor_independently():
    engine = DiffEngine()
    prev = segs("Alpha stays here.", "Beta gets deleted.")
    curr = segs("Prelude.", "Alpha stays here.")

    survivor = Anchor.create(prev[0].text, paragraph_index=0, start_offset=0, end_offset=5)  # "Alpha"
    doomed = Anchor.create(prev[1].text, paragraph_index=1, start_offset=0, end_offset=4)  # "Beta"

    diff = engine.compute(prev, curr)
    results = AnchorService().remap([survivor, doomed], diff)

    assert len(results) == 2
    assert isinstance(results[0], Remapped)
    assert results[0].anchor.paragraph_index == 1  # "Alpha stays here." shifted down
    assert results[0].span == Span(paragraph_index=1, start=0, end=5)
    assert isinstance(results[1], Removed)
    assert results[1].anchor.state is AnchorState.REMOVED


def test_unchanged_change_kind_is_present_for_shifted_paragraph():
    # Guard the assumption the shifted-paragraph test relies on: an unchanged but
    # repositioned paragraph is classified UNCHANGED with an updated curr_index.
    engine = DiffEngine()
    diff = engine.compute(segs("A.", "B."), segs("Intro.", "A.", "B."))
    unchanged = {c.prev_index: c.curr_index for c in diff.unchanged}
    assert unchanged == {0: 1, 1: 2}
    assert all(c.kind is ChangeKind.UNCHANGED for c in diff.unchanged)
