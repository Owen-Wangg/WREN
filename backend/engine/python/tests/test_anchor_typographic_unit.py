"""Unit and property tests for the engine's typographic quote matching (step 4).

Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 3.4).

Covers:
- ``_fold_typographic_quotes``: exactly the 10 listed code points, length kept,
  every other BMP character unchanged (same table as the TS fold test).
- One test per step-4 method: ``typographic``, ``typographic-case-insensitive``,
  ``typographic-fuzzy-whitespace``.
- The step-4 verification guard, with inputs that reach it through the
  pre-existing ``_fuzzy_find`` leading-whitespace quirk and through the
  length-changing ``lower()`` of U+0130 (LATIN CAPITAL LETTER I WITH DOT ABOVE).
- Property 3 (Hypothesis): fold round-trip.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

from hypothesis import assume, event, given
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_testing import wren_settings  # noqa: E402


# Shared fold table (keep in sync with quoteResolution.test.ts).
_SINGLE_CLASS = ("\u2018", "\u2019", "\u201A", "\u201B", "\u2032")
_DOUBLE_CLASS = ("\u201C", "\u201D", "\u201E", "\u201F", "\u2033")
EXPECTED_FOLD = {**{c: "'" for c in _SINGLE_CLASS}, **{c: '"' for c in _DOUBLE_CLASS}}

fold = handler._fold_typographic_quotes
locate = handler._locate_quote_in_paragraph


def norm_ws(text: str) -> str:
    return handler._normalize_whitespace(text)


def equivalent(a: str, b: str) -> bool:
    return norm_ws(fold(a)).lower() == norm_ws(fold(b)).lower()


# --------------------------------------------------------------------------- #
# Fold table                                                                  #
# --------------------------------------------------------------------------- #


def test_fold_table_is_exactly_the_ten_code_points() -> None:
    assert handler._TYPOGRAPHIC_QUOTE_FOLD == {ord(k): v for k, v in EXPECTED_FOLD.items()}
    assert len(handler._TYPOGRAPHIC_QUOTE_FOLD) == 10
    for src, dst in EXPECTED_FOLD.items():
        assert fold(src) == dst


def test_fold_keeps_length_and_leaves_other_characters_unchanged() -> None:
    # Every BMP code point except surrogates (not valid on their own in str ops).
    bmp = "".join(chr(cp) for cp in range(0x10000) if not 0xD800 <= cp <= 0xDFFF)
    folded = fold(bmp)
    assert len(folded) == len(bmp)
    for orig, new in zip(bmp, folded):
        if orig in EXPECTED_FOLD:
            assert new == EXPECTED_FOLD[orig]
        else:
            assert new == orig, f"U+{ord(orig):04X} changed to U+{ord(new):04X}"
    # Astral characters (e.g. emoji) pass through untouched as well.
    assert fold("a\U0001F600\u2019b") == "a\U0001F600'b"


# --------------------------------------------------------------------------- #
# One test per step-4 method                                                  #
# --------------------------------------------------------------------------- #

_PARA = "The panel found that Fiona\u2019s conduct was reasonable."
_SPAN_START = _PARA.index("Fiona")
_SPAN = "Fiona\u2019s conduct"


def test_method_typographic() -> None:
    assert locate(_PARA, "Fiona's conduct") == (
        _SPAN_START, _SPAN_START + len(_SPAN), "typographic",
    )


def test_method_typographic_case_insensitive() -> None:
    assert locate(_PARA, "FIONA'S CONDUCT") == (
        _SPAN_START, _SPAN_START + len(_SPAN), "typographic-case-insensitive",
    )


def test_method_typographic_fuzzy_whitespace() -> None:
    para = "The panel found that Fiona\u2019s \n conduct was reasonable."
    start = para.index("Fiona")
    end = para.index("conduct") + len("conduct")
    assert locate(para, "fiona's conduct") == (start, end, "typographic-fuzzy-whitespace")
    assert para[start:end] == "Fiona\u2019s \n conduct"


def test_step4_not_reached_when_fold_changes_nothing() -> None:
    # No typographic characters anywhere: steps 1-3 miss and step 4 short-circuits.
    assert locate("Fionas conduct was noted.", "Fiona's conduct") is None


# --------------------------------------------------------------------------- #
# Verification guard                                                          #
# --------------------------------------------------------------------------- #


def test_guard_rejects_fuzzy_span_shifted_by_leading_whitespace() -> None:
    """Leading paragraph whitespace: ``_fuzzy_find`` maps normalized position 0
    to the stripped leading space, so 4c's raw span starts one character early
    and drops the last character. The guard rejects it and no anchor is made.
    """
    para = " Fiona\u2019s  conduct was noted."
    quote = "fiona's conduct"  # case and whitespace differ, so 4a and 4b miss
    fp, fq = fold(para), fold(quote)
    assert fp.find(fq) == -1 and fp.lower().find(fq.lower()) == -1

    raw_start = handler._fuzzy_find(fp, fq)
    raw_end = handler._fuzzy_end_offset(fp, raw_start, len(norm_ws(fq)))
    assert (raw_start, raw_end) == (0, 16)
    assert para[raw_start:raw_end] == " Fiona\u2019s  conduc"
    assert not equivalent(para[raw_start:raw_end], quote)

    assert locate(para, quote) is None


def test_guard_rejects_span_shifted_by_length_changing_lower() -> None:
    """'\u0130'.lower() is two code points, so every index in ``fp.lower()``
    after it is shifted by one. 4b's raw span and 4c's raw span both start
    one character late. The guard rejects both and no anchor is made.
    """
    assert len("\u0130".lower()) == 2
    para = "\u0130stanbul: Fiona\u2019s conduct was noted."
    quote = "FIONA'S CONDUCT"  # case differs, so 4a misses
    fp, fq = fold(para), fold(quote)
    true_start = para.index("Fiona")
    assert fp.find(fq) == -1

    raw_4b = fp.lower().find(fq.lower())
    assert raw_4b == true_start + 1
    assert not equivalent(para[raw_4b:raw_4b + len(fq)], quote)

    raw_4c = handler._fuzzy_find(fp, fq)
    assert raw_4c == true_start + 1
    raw_4c_end = handler._fuzzy_end_offset(fp, raw_4c, len(norm_ws(fq)))
    assert not equivalent(para[raw_4c:raw_4c_end], quote)

    assert locate(para, quote) is None


def test_guard_rejects_4b_then_accepts_correct_4c_span() -> None:
    """Both quirks together cancel in 4c: the leading space shifts the fuzzy
    mapping back by one and U+0130 shifts ``lower()`` forward by one. The guard
    rejects 4b's shifted span and falls through to 4c's correct span.
    """
    para = " \u0130stanbul: Fiona\u2019s conduct was noted."
    quote = "FIONA'S CONDUCT"
    fp, fq = fold(para), fold(quote)
    true_start = para.index("Fiona")

    raw_4b = fp.lower().find(fq.lower())
    assert raw_4b == true_start + 1
    assert not equivalent(para[raw_4b:raw_4b + len(fq)], quote)

    assert locate(para, quote) == (
        true_start, true_start + len(_SPAN), "typographic-fuzzy-whitespace",
    )


# --------------------------------------------------------------------------- #
# Property 3: fold round-trip                                                 #
# --------------------------------------------------------------------------- #

_NON_WS = list("abcdefghijklmnopqrstuvwxyzABCDEFGHIJ.,;:()-'\"") + list(EXPECTED_FOLD)
_QUOTE_HEAVY = st.sampled_from(list(EXPECTED_FOLD) + ["'", '"'])
_char = st.one_of(st.sampled_from(_NON_WS), _QUOTE_HEAVY)
_word = st.text(alphabet=_char, min_size=1, max_size=6)
# ASCII whitespace that both ``\s`` and ``_fuzzy_find``'s norm_to_orig treat as space.
_WS_RUNS = [" ", "  ", "\t", "\n", " \n ", "\r\n"]


class _FakeCursor:
    def __init__(self, calls: list[tuple[str, tuple[Any, ...]]]) -> None:
        self._calls = calls

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        self._calls.append((" ".join(sql.split()), tuple(params)))


class _FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self.calls)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def inserts(self, table: str) -> list[tuple[Any, ...]]:
        prefix = f"INSERT INTO {table} "
        return [p for sql, p in self.calls if sql.startswith(prefix)]


def _occurrences(hay: str, needle: str) -> int:
    count, pos = 0, hay.find(needle)
    while pos != -1:
        count += 1
        pos = hay.find(needle, pos + 1)
    return count


@st.composite
def _round_trip_input(draw: st.DrawFn) -> tuple[str, int, int, str]:
    words = draw(st.lists(_word, min_size=1, max_size=8))
    seps = [draw(st.sampled_from(_WS_RUNS)) for _ in words[1:]]
    para = words[0] + "".join(s + w for s, w in zip(seps, words[1:]))
    if draw(st.booleans()):
        para += draw(st.sampled_from(_WS_RUNS))  # trailing whitespace is fine

    non_ws = [k for k, ch in enumerate(para) if not ch.isspace()]
    i = draw(st.sampled_from(non_ws))
    last = draw(st.sampled_from([k for k in non_ws if k >= i]))
    j = last + 1

    query = fold(para[i:j])
    case = draw(st.sampled_from(["keep", "lower", "upper", "swapcase"]))
    if case != "keep":
        query = getattr(query, case)()
    if draw(st.booleans()):
        parts = re.split(r"(\s+)", query)
        query = "".join(
            draw(st.sampled_from(_WS_RUNS)) if part and part.isspace() else part
            for part in parts
        )
    return para, i, j, query


@wren_settings()
@given(_round_trip_input())
def test_property_fold_round_trip(data: tuple[str, int, int, str]) -> None:
    """Property 3: Fold round-trip - a folded substring always maps back to an
    original span.

    For any substring p[i:j], the query fold(p[i:j]) (optionally re-cased and
    with its whitespace runs changed) is located by the fixed matcher; the span
    (s, e) is in bounds, s <= i, equivalent to the query, and the persisted
    quoted_text is p[s:e].

    Generation scope (documented exclusions):
    - Paragraphs never start with whitespace and use only ASCII whitespace
      (space, tab, LF, CR): avoids the pre-existing ``_fuzzy_find``
      leading-whitespace offset quirk and its Unicode-space mismatch, which
      steps 1-3 keep unchanged by design (3.3).
    - p[i:j] starts and ends on non-whitespace, like a model quote: a query
      with leading whitespace is stripped by normalization, so a
      whitespace-level match legitimately starts after i.
    - ASCII letters only (no length-changing ``lower()``; covered by the
      guard unit tests above).
    - The equivalence class of p[i:j] occurs once in p: steps 1-3 run first by
      design (preservation), so an exact or case-only match of the re-cased or
      re-spaced query elsewhere in p may legitimately win at a position > i.

    **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
    """
    para, i, j, query = data
    key = norm_ws(fold(query)).lower()
    assume(_occurrences(norm_ws(fold(para)).lower(), key) == 1)

    result = locate(para, query)
    assert result is not None, f"no match for {query!r} in {para!r} (span {i}:{j})"
    s, e, method = result
    event(f"method={method}")
    assert 0 <= s < e <= len(para), (s, e, len(para))
    assert s <= i, (s, i)
    assert equivalent(para[s:e], query), (para[s:e], query)

    conn = _FakeConn()
    item = {
        'kind': 'inline',
        'error_category_id': 'cat-1',
        'question_text': 'Q?',
        'anchor': {'paragraphIndex': 0, 'quotedText': query},
    }
    assert handler.insert_feedback_items(
        'doc-1', 'draft-1', 'user-1', [item], [{'text': para}], conn,
        wipe_existing=False,
    ) == 1
    assert conn.inserts("feedback_item")[0][5] == para[s:e]
    anchor_rows = conn.inserts("anchor")
    assert len(anchor_rows) == 1
    assert anchor_rows[0][4:7] == (s, e, handler.compute_content_fingerprint(para, s, e))
