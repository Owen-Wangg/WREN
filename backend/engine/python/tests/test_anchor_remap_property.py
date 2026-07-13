"""Property-based test for the Anchor Service — Property 6 (surviving spans).

Feature: wren-writing-coach, Property 6: Anchor re-mapping preserves surviving spans

Design (design.md "Property 6: Anchor re-mapping preserves surviving spans"):
  *For any* Draft and any edit, an Anchor over text that survives the edit
  (possibly shifted) is re-mapped so that the content at its new span still
  matches the Anchor's stored fingerprint.

Validates: Requirements 9.1, 9.3 (REQ-ANCHOR-01)
  9.1 — the same fingerprint function anchors and re-maps, so a surviving span
        is recognised across Drafts.
  9.3 — a confident match preserves the association; offsets and/or the
        paragraph index may shift, but the association is carried forward
        (never dropped) and points at the same content.

Relationship to Property 7 (task 8.5)
-------------------------------------
Property 7 covers the *negative* direction (delete / rewrite-beyond-recognition
/ ambiguity => ``removed``, never mis-attach) over arbitrary edits. Property 6
is the *positive* direction: when a span genuinely survives an edit in a
re-mappable way, the Anchor MUST be re-mapped rather than dropped. This test
therefore generates edits under which survival is unambiguous, and asserts the
re-map both happens and lands on the original content. Ambiguous edits (where
removal is the correct answer) are Property 7's domain.

Strategy
--------
Each example builds a genuine "previous Draft" whose paragraphs each carry a
unique ``paraN`` tag (so the real :class:`DiffEngine`'s paragraph alignment is
unambiguous) and one chosen paragraph additionally carries a unique marker token
that the Anchor is placed over (so the stored :class:`ContentFingerprint` is
authentic and the marker occurs exactly once in the Draft). Two survival modes
exercise the two facets of "possibly shifted":

* ``index_shift`` — the anchored paragraph is kept byte-identical while other
  paragraphs are kept / deleted / rewritten and fresh unique paragraphs are
  inserted around it. The identical paragraph is classified ``UNCHANGED`` and
  the span re-maps with preserved offsets but a shifted paragraph index (9.3).
* ``offset_shift`` — every other paragraph is retained identically and the
  anchored paragraph alone is edited in place (filler text prepended, keeping
  the marker intact). The paragraph is classified ``CHANGED`` and the span
  re-maps to a shifted character offset within it (9.3).

The real :class:`DiffEngine` computes the Diff — exactly the production flow —
and the Anchor is re-mapped. The universal invariant: the result is always
:class:`Remapped` (the surviving span is never dropped), and the content at the
new span still matches the Anchor's stored fingerprint (9.1).
"""
from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wren_engine import (
    Anchor,
    AnchorService,
    AnchorState,
    DiffEngine,
    Remapped,
    Segment,
    compute_fingerprint,
)
from wren_testing import wren_settings

# Filler drawn from a small vocabulary of lowercase common words. The marker and
# the ``paraN`` paragraph tags are deliberately outside this vocabulary so that
# neither is ever a substring of filler text — the anchored marker therefore
# occurs exactly once in the Draft and re-mapping is confident.
_FILLER = ["the", "cat", "dog", "sat", "ran", "fox", "red", "big", "law", "case", "court", "held"]
_MARKER = "ANCHORWORD"

_filler_words = st.lists(st.sampled_from(_FILLER), min_size=0, max_size=4)


def _segments(texts: list[str]) -> list[Segment]:
    return [Segment(index=k, text=t) for k, t in enumerate(texts)]


@st.composite
def _survivor_scenario(draw: st.DrawFn):
    """Generate ``(prev_texts, (para_index, start, end), curr_texts)``.

    ``prev_texts`` is the previous Draft; the middle tuple is the marker span the
    Anchor is placed over; ``curr_texts`` is an edited current Draft under which
    that span provably survives (index-shifted or offset-shifted).
    """
    n_prev = draw(st.integers(min_value=1, max_value=4))
    anchor_para = draw(st.integers(min_value=0, max_value=n_prev - 1))

    prev_texts: list[str] = []
    anchor_start = anchor_end = -1
    for pid in range(n_prev):
        prefix = draw(_filler_words)
        if pid == anchor_para:
            suffix = draw(_filler_words)
            tokens = [f"para{pid}"] + prefix + [_MARKER] + suffix
            text = " ".join(tokens)
            anchor_start = text.index(_MARKER)
            anchor_end = anchor_start + len(_MARKER)
        else:
            text = " ".join([f"para{pid}"] + prefix)
        prev_texts.append(text)

    mode = draw(st.sampled_from(["index_shift", "offset_shift"]))

    if mode == "offset_shift":
        # Only the anchored paragraph changes (>=1 word prepended so the offset
        # genuinely shifts). Every other paragraph is retained identically and
        # nothing is inserted/deleted, so the paragraph is cleanly CHANGED and its
        # neighbours anchor the diff alignment.
        curr_texts = list(prev_texts)
        prepend = draw(st.lists(st.sampled_from(_FILLER), min_size=1, max_size=4))
        append = draw(_filler_words)
        edited = " ".join(prepend) + " " + prev_texts[anchor_para]
        if append:
            edited = edited + " " + " ".join(append)
        curr_texts[anchor_para] = edited
    else:
        # index_shift: the anchored paragraph is kept byte-identical (classified
        # UNCHANGED, possibly repositioned). Other paragraphs may be kept /
        # deleted / rewritten, and fresh unique paragraphs inserted around them.
        counter = [n_prev]

        def _fresh() -> str:
            pid = counter[0]
            counter[0] += 1
            return " ".join([f"para{pid}"] + draw(_filler_words))

        curr_texts = []
        for _ in range(draw(st.integers(min_value=0, max_value=2))):  # leading inserts
            curr_texts.append(_fresh())
        for pid in range(n_prev):
            if pid == anchor_para:
                curr_texts.append(prev_texts[pid])  # identical -> UNCHANGED
            else:
                action = draw(st.sampled_from(["keep", "delete", "rewrite"]))
                if action == "keep":
                    curr_texts.append(prev_texts[pid])
                elif action == "rewrite":
                    curr_texts.append(_fresh())
                # "delete" -> contribute nothing
            for _ in range(draw(st.integers(min_value=0, max_value=1))):  # interleaved inserts
                curr_texts.append(_fresh())

    return prev_texts, (anchor_para, anchor_start, anchor_end), curr_texts


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_survivor_scenario())
def test_anchor_remap_preserves_surviving_spans(scenario) -> None:
    # Feature: wren-writing-coach, Property 6: Anchor re-mapping preserves surviving spans
    # Validates: Requirements 9.1, 9.3
    prev_texts, (pi, start, end), curr_texts = scenario

    anchor = Anchor.create(
        prev_texts[pi], paragraph_index=pi, start_offset=start, end_offset=end
    )
    stored_fp = anchor.content_fingerprint

    diff = DiffEngine().compute(_segments(prev_texts), _segments(curr_texts))
    [result] = AnchorService().remap([anchor], diff)

    # Property 6: a surviving span is ALWAYS re-mapped, never dropped (9.1, 9.3).
    assert isinstance(result, Remapped), (prev_texts, (pi, start, end), curr_texts)

    span = result.span
    # The new span is a real location inside the current Draft.
    assert 0 <= span.paragraph_index < len(curr_texts)
    paragraph = curr_texts[span.paragraph_index]
    assert 0 <= span.start <= span.end <= len(paragraph)

    # The content now at the re-mapped span still matches the stored fingerprint,
    # and is exactly the text that was originally anchored (9.1, 9.3).
    assert compute_fingerprint(paragraph, span.start, span.end).matches(stored_fp)
    assert paragraph[span.start:span.end] == prev_texts[pi][start:end]

    # The re-mapped Anchor stays active and self-consistent with its new span.
    assert result.anchor.state is AnchorState.ACTIVE
    assert result.anchor.paragraph_index == span.paragraph_index
    assert (result.anchor.start_offset, result.anchor.end_offset) == (
        span.start,
        span.end,
    )
    assert result.anchor.content_fingerprint.matches(stored_fp)
