"""Example-based tests: footnote-placeholder generator cases for the Anchor
Service / `compute_fingerprint` (footnote-citation-support spec, Task 10.3).

Paragraph text containing one or more `[N]`/`[?]` placeholders is exercised
through `compute_fingerprint` and `AnchorService.remap` exactly as any other
literal text — placeholders are not special-cased anywhere in this module;
these tests confirm that holds for spans that happen to include a
placeholder.

Validates: Requirements 7.3

The Property 15 property-based test (Task 10.4) is a separate, optional
task and is intentionally NOT here.
"""
from wren_engine import (
    Anchor,
    AnchorState,
    DiffEngine,
    Remapped,
    AnchorService,
    Span,
    compute_fingerprint,
)


def segs(*texts):
    from wren_engine import Segment

    return [Segment(index=i, text=t) for i, t in enumerate(texts)]


# --------------------------------------------------------------------------- #
# compute_fingerprint treats `[N]`/`[?]` as ordinary literal text             #
# --------------------------------------------------------------------------- #

def test_fingerprint_over_a_span_including_a_footnote_placeholder_is_stable():
    text = "See the holding below.[1] It was decisive."
    # Span covering "below.[1]" (includes the placeholder).
    start = text.index("below.[1]")
    end = start + len("below.[1]")
    fp1 = compute_fingerprint(text, start, end)
    fp2 = compute_fingerprint(text, start, end)
    assert fp1 == fp2
    assert fp1.matches(fp2)


def test_fingerprint_distinguishes_different_placeholder_numbers():
    """The placeholder's digits ARE part of the literal text, so two
    otherwise-identical spans differing only in footnote NUMBER produce
    different fingerprints — this is expected literal-text behavior, not a
    special footnote-aware comparison."""
    span_with_1 = compute_fingerprint("Claim.[1]", 0, len("Claim.[1]"))
    span_with_2 = compute_fingerprint("Claim.[2]", 0, len("Claim.[2]"))
    assert span_with_1.text_hash != span_with_2.text_hash


def test_fingerprint_normalizes_case_and_whitespace_around_a_placeholder():
    a = compute_fingerprint("The CAT sat.[1]", 4, 16)  # "CAT sat.[1]"
    b = compute_fingerprint("the cat sat.[1]", 4, 16)  # "cat sat.[1]"
    assert a.matches(b)


# --------------------------------------------------------------------------- #
# AnchorService.remap re-maps a span containing a placeholder like any other #
# --------------------------------------------------------------------------- #

def test_anchor_spanning_a_placeholder_remaps_correctly_when_surroundings_unchanged():
    engine = DiffEngine()
    prev = segs("The court held that the appeal succeeded.[1] Costs awarded.")
    # Insert an unrelated paragraph above — shifts index but not content.
    curr = segs(
        "Intro paragraph.",
        "The court held that the appeal succeeded.[1] Costs awarded.",
    )
    # Anchor over "succeeded.[1]" (includes the placeholder).
    text = prev[0].text
    start = text.index("succeeded.[1]")
    end = start + len("succeeded.[1]")
    anchor = Anchor.create(text, paragraph_index=0, start_offset=start, end_offset=end)

    diff = engine.compute(prev, curr)
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Remapped)
    assert result.anchor.paragraph_index == 1
    assert (result.anchor.start_offset, result.anchor.end_offset) == (start, end)
    assert result.anchor.state is AnchorState.ACTIVE
    assert result.span == Span(paragraph_index=1, start=start, end=end)
    # The placeholder text is preserved verbatim at the remapped offsets.
    assert curr[1].text[start:end] == "succeeded.[1]"


def test_anchor_spanning_a_placeholder_survives_an_in_place_edit_elsewhere():
    engine = DiffEngine()
    prev = segs("Hello brave world.[1]")
    curr = segs("Well, Hello brave world.[1]")
    # Anchor over "brave" (does not include the placeholder itself here,
    # confirming an edit elsewhere in a placeholder-bearing paragraph doesn't
    # disrupt an unrelated anchored span).
    anchor = Anchor.create(prev[0].text, paragraph_index=0, start_offset=6, end_offset=11)

    diff = engine.compute(prev, curr)
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Remapped)
    assert curr[0].text[result.anchor.start_offset : result.anchor.end_offset] == "brave"


def test_anchor_over_a_malformed_question_mark_placeholder_remaps_like_any_text():
    engine = DiffEngine()
    prev = segs("An orphaned reference.[?] noted here.")
    curr = segs("Intro.", "An orphaned reference.[?] noted here.")
    text = prev[0].text
    start = text.index("[?]")
    end = start + len("[?]")
    anchor = Anchor.create(text, paragraph_index=0, start_offset=start, end_offset=end)

    diff = engine.compute(prev, curr)
    [result] = AnchorService().remap([anchor], diff)

    assert isinstance(result, Remapped)
    assert result.anchor.paragraph_index == 1
    assert curr[1].text[result.anchor.start_offset : result.anchor.end_offset] == "[?]"
