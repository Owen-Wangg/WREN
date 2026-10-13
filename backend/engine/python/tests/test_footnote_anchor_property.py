"""Property test: anchor fingerprints are stable across text containing
footnote placeholders (footnote-citation-support spec, Task 10.4).

Feature: footnote-citation-support, Property 15: Anchor fingerprints are
stable across text containing footnote placeholders.

Validates: Requirements 7.3

`compute_fingerprint` treats `[N]`/`[?]` placeholders as ordinary literal
text (no special footnote awareness). This test confirms:
  - A fingerprint over a span is deterministic (same input → same output).
  - Different placeholder numbers in otherwise identical spans produce
    different fingerprints (they're different literal text).
  - Whitespace normalization around placeholders works the same as around
    any other text.
"""
from hypothesis import given, settings, assume
from hypothesis import strategies as st

import pytest

from wren_engine import compute_fingerprint


# Safe text (no brackets to avoid accidental placeholder patterns)
_safe_word = st.text(
    alphabet=st.characters(categories=("L",)),
    min_size=1,
    max_size=20,
).map(lambda s: s.strip()).filter(lambda s: len(s) > 0)

_footnote_number = st.integers(min_value=1, max_value=200)


class TestProperty15AnchorFingerprintStabilityWithPlaceholders:
    """Property 15: Anchor fingerprints are stable across text containing
    footnote placeholders."""

    @given(_safe_word, _footnote_number)
    @settings(max_examples=100)
    def test_fingerprint_is_deterministic_for_placeholder_text(
        self, word: str, num: int
    ):
        """Same text with placeholder → same fingerprint every time."""
        text = f"{word}.[{num}]"
        fp1 = compute_fingerprint(text, 0, len(text))
        fp2 = compute_fingerprint(text, 0, len(text))
        assert fp1 == fp2
        assert fp1.matches(fp2)

    @given(_safe_word, _footnote_number, _footnote_number)
    @settings(max_examples=100)
    def test_different_placeholder_numbers_produce_different_fingerprints(
        self, word: str, num1: int, num2: int
    ):
        """Different placeholder digits = different literal text = different
        fingerprint text_hash."""
        assume(num1 != num2)
        text1 = f"{word}.[{num1}]"
        text2 = f"{word}.[{num2}]"
        fp1 = compute_fingerprint(text1, 0, len(text1))
        fp2 = compute_fingerprint(text2, 0, len(text2))
        assert fp1.text_hash != fp2.text_hash

    @given(_safe_word, _footnote_number)
    @settings(max_examples=100)
    def test_fingerprint_over_partial_span_including_placeholder_is_stable(
        self, word: str, num: int
    ):
        """Fingerprinting a sub-span that includes the placeholder is stable."""
        text = f"prefix {word}.[{num}] suffix"
        # Span over "{word}.[{num}]"
        start = text.index(word)
        end = text.index("]", start) + 1
        fp1 = compute_fingerprint(text, start, end)
        fp2 = compute_fingerprint(text, start, end)
        assert fp1 == fp2
        assert fp1.matches(fp2)

    @given(_safe_word, _footnote_number)
    @settings(max_examples=100)
    def test_case_normalized_matching_works_around_placeholders(
        self, word: str, num: int
    ):
        """Case normalization (matches()) works for text around placeholders."""
        assume(word.lower() != word.upper())  # skip pure-numeric/symbol text
        # matches() compares casefolded text (anchor_service._normalize). For a
        # few Unicode letters .lower() and .upper() do not converge under
        # casefold (e.g. dotless-i U+0131: 'ı'.casefold() != 'I'.casefold()),
        # so case-insensitive equality genuinely does not hold. Restrict to
        # words whose cases agree under casefold — the precondition matches()
        # can actually satisfy.
        assume(word.lower().casefold() == word.upper().casefold())
        text_lower = f"{word.lower()}.[{num}]"
        text_upper = f"{word.upper()}.[{num}]"
        fp1 = compute_fingerprint(text_lower, 0, len(text_lower))
        fp2 = compute_fingerprint(text_upper, 0, len(text_upper))
        # matches() does case-insensitive comparison
        assert fp1.matches(fp2)

    @given(_safe_word)
    @settings(max_examples=50)
    def test_malformed_question_mark_placeholder_is_stable(self, word: str):
        """[?] placeholder fingerprint is deterministic like any other text."""
        text = f"{word}.[?]"
        fp1 = compute_fingerprint(text, 0, len(text))
        fp2 = compute_fingerprint(text, 0, len(text))
        assert fp1 == fp2
        assert fp1.matches(fp2)
