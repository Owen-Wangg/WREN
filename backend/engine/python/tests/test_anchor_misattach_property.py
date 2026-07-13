"""Property-based test for the Anchor Service — Property 7 (never mis-attach).

Feature: wren-writing-coach, Property 7: Anchors never mis-attach

Design (design.md "Property 7: Anchors never mis-attach"):
  *For any* edit that deletes, rewrites beyond recognition, or makes ambiguous
  the text an Anchor refers to, the Anchor is marked ``removed`` and is never
  bound to a span whose content differs from its stored fingerprint.

Validates: Requirements 9.2, 9.5 (REQ-ANCHOR-01)
  9.2 — text deleted or rewritten beyond recognition => Anchor marked ``removed``.
  9.5 — an ambiguous (not-confident) match => ``removed`` rather than attach to an
        incorrect span.

Strategy
--------
Each example builds a genuine "previous Draft" (a list of paragraph texts drawn
from a small, collision-prone word vocabulary so repeated/ambiguous text arises
naturally), anchors a Feedback Item over a real word-aligned span in that Draft
(so the stored :class:`ContentFingerprint` is authentic), then produces an
arbitrary "current Draft" by applying per-paragraph edits (keep / delete /
rewrite / duplicate) plus inserted paragraphs. The real :class:`DiffEngine`
computes the Diff — exactly the production flow — and the Anchor is re-mapped.

The universal invariant that captures "never mis-attach": whenever ``remap``
returns a :class:`Remapped` result, the content actually present at the new span
in the current Draft must still match the Anchor's stored fingerprint. Any edit
that leaves the target deleted, unrecognizable, or ambiguous must instead yield a
:class:`Removed` Anchor carrying no span. This single invariant subsumes all
three Property 7 triggers (delete / rewrite / ambiguity).
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
    Removed,
    Segment,
    compute_fingerprint,
)
from wren_testing import wren_settings

# A deliberately small vocabulary so identical words/paragraphs recur across a
# Draft — this is what makes deletion, wholesale rewrites, and ambiguous repeated
# text (the three Property 7 triggers) show up frequently during generation.
_WORDS = ["the", "cat", "dog", "sat", "ran", "fox", "red", "big", "law", "case"]

_words = st.lists(st.sampled_from(_WORDS), min_size=1, max_size=6)


def _paragraph(words: list[str]) -> str:
    return " ".join(words)


def _word_span(words: list[str], i: int, j: int) -> tuple[int, int]:
    """Char offsets of the word-range ``words[i..j]`` within their joined text."""
    start = 0 if i == 0 else len(_paragraph(words[:i])) + 1
    end = start + len(_paragraph(words[i : j + 1]))
    return start, end


@st.composite
def _anchor_scenario(draw: st.DrawFn):
    """Generate ``(prev_texts, (para_index, start, end), curr_texts)``.

    ``prev_texts`` is the previous Draft; the middle tuple is a real word-aligned
    anchor span within it; ``curr_texts`` is an arbitrarily edited current Draft.
    """
    prev_words = draw(st.lists(_words, min_size=1, max_size=4))
    prev_texts = [_paragraph(w) for w in prev_words]

    # Anchor over a word-aligned, non-empty span in a chosen paragraph.
    pi = draw(st.integers(min_value=0, max_value=len(prev_words) - 1))
    words = prev_words[pi]
    i = draw(st.integers(min_value=0, max_value=len(words) - 1))
    j = draw(st.integers(min_value=i, max_value=len(words) - 1))
    start, end = _word_span(words, i, j)

    # Build the current Draft with a mix of edits that exercise every trigger.
    curr_texts: list[str] = []
    if draw(st.booleans()):  # sometimes insert a fresh paragraph at the top
        curr_texts.append(_paragraph(draw(_words)))
    for text in prev_texts:
        action = draw(st.sampled_from(["keep", "delete", "rewrite", "duplicate"]))
        if action == "keep":
            curr_texts.append(text)  # -> UNCHANGED (possibly shifted)
        elif action == "delete":
            pass  # -> DELETED
        elif action == "rewrite":
            curr_texts.append(_paragraph(draw(_words)))  # -> CHANGED / rewritten
        else:  # duplicate the paragraph in place -> repeated (ambiguous) text
            curr_texts.append(f"{text} {text}")
        if draw(st.booleans()):  # sprinkle inserted paragraphs between originals
            curr_texts.append(_paragraph(draw(_words)))

    return prev_texts, (pi, start, end), curr_texts


def _segments(texts: list[str]) -> list[Segment]:
    return [Segment(index=k, text=t) for k, t in enumerate(texts)]


@pytest.mark.property
@wren_settings(max_examples=200)
@given(_anchor_scenario())
def test_anchors_never_mis_attach(scenario) -> None:
    # Feature: wren-writing-coach, Property 7: Anchors never mis-attach
    # Validates: Requirements 9.2, 9.5
    prev_texts, (pi, start, end), curr_texts = scenario

    anchor = Anchor.create(
        prev_texts[pi], paragraph_index=pi, start_offset=start, end_offset=end
    )
    stored_fp = anchor.content_fingerprint

    diff = DiffEngine().compute(_segments(prev_texts), _segments(curr_texts))
    [result] = AnchorService().remap([anchor], diff)

    if isinstance(result, Remapped):
        span = result.span
        # The new span must be a real location inside the current Draft.
        assert 0 <= span.paragraph_index < len(curr_texts)
        paragraph = curr_texts[span.paragraph_index]
        assert 0 <= span.start <= span.end <= len(paragraph)

        # Core Property 7 guarantee: a bound Anchor is NEVER attached to a span
        # whose content differs from its stored fingerprint (9.2, 9.5).
        content_here = compute_fingerprint(paragraph, span.start, span.end)
        assert content_here.matches(stored_fp)

        # The re-mapped Anchor stays active and self-consistent with its span.
        assert result.anchor.state is AnchorState.ACTIVE
        assert result.anchor.paragraph_index == span.paragraph_index
        assert (result.anchor.start_offset, result.anchor.end_offset) == (
            span.start,
            span.end,
        )
        assert result.anchor.content_fingerprint.matches(stored_fp)
    else:
        # Deleted / rewritten-beyond-recognition / ambiguous => removed, and it
        # carries no current-Draft span, so it can never mis-attach (9.2, 9.5).
        assert isinstance(result, Removed)
        assert result.anchor.state is AnchorState.REMOVED
        assert not hasattr(result, "span")
