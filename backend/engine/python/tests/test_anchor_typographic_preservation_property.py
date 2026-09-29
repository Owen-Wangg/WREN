"""Preservation property tests: typographic quote anchor matching.

Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 2).

Property 2: Preservation - Non-buggy inputs behave exactly as before.

For any (para_text, model_quote) where ``is_bug_condition`` does NOT hold, the
subject matcher (``locate``: ``handler._locate_quote_in_paragraph`` when it
exists, else the current inline steps) returns exactly what the frozen
original three-step matcher returns, and ``insert_feedback_items`` persists
the same rows, logs and content fingerprints as the unfixed code.

These tests are written BEFORE the fix and MUST PASS on the unfixed code.

The frozen oracle (``locate_original``), the ``locate`` wrapper, the fold and
the fake psycopg connection are shared with the Task 1 bug-condition module.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
"""
from __future__ import annotations

import logging
import os
import sys
from contextlib import contextmanager
from typing import Any, Iterator

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import handler  # noqa: E402
from test_anchor_typographic_bug_condition import (  # noqa: E402
    _DOUBLE_CLASS,
    _SINGLE_CLASS,
    _FakeConn,
    fold,
    is_bug_condition,
    locate,
    locate_original,
)
from wren_testing import wren_settings  # noqa: E402


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

_SINGLE = ("'",) + _SINGLE_CLASS
_DOUBLE = ('"',) + _DOUBLE_CLASS
_QUOTE_MEMBERS = _SINGLE + _DOUBLE


def _quote_class(ch: str) -> str:
    """Equivalence class label: 'S', 'D', or the character itself."""
    if ch in _SINGLE:
        return "S"
    if ch in _DOUBLE:
        return "D"
    return ch


class _ListHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextmanager
def _capture_logs() -> Iterator[list[str]]:
    """Capture handler.logger messages (usable inside Hypothesis tests)."""
    h = _ListHandler()
    handler.logger.addHandler(h)
    try:
        yield h.messages
    finally:
        handler.logger.removeHandler(h)


def _item(anchor: dict[str, Any] | None, kind: str = "inline") -> dict[str, Any]:
    item: dict[str, Any] = {
        "kind": kind,
        "error_category_id": "cat-1",
        "question_text": "What does this show?",
    }
    if anchor is not None:
        item["anchor"] = anchor
    return item


def _insert(
    items: list[dict[str, Any]], segments: list[dict[str, Any]]
) -> tuple[_FakeConn, list[str], int]:
    conn = _FakeConn()
    with _capture_logs() as logs:
        count = handler.insert_feedback_items(
            "doc-1", "draft-1", "user-1", items, segments, conn, wipe_existing=False,
        )
    return conn, list(logs), count


def _expected_success_log(kind: str, para: int, start: int, end: int, method: str) -> str:
    return f"Anchor matched ({method}) kind={kind} para={para} offsets={start}:{end}"


def _expected_failure_log(kind: str, para: int, quote: str, para_text: str) -> str:
    return (
        f"Anchor match FAILED kind={kind} para={para} "
        f"quote_preview={quote[:80]!r} "
        f"para_preview={para_text[:80]!r}"
    )


# --------------------------------------------------------------------------- #
# Strategies                                                                  #
# --------------------------------------------------------------------------- #

_ALPHABET = "abcXYZ" + " \t\n" + ",.;:-()" + "".join(_QUOTE_MEMBERS)
_paragraph = st.text(alphabet=_ALPHABET, min_size=1, max_size=40)
_random_quote = st.text(alphabet=_ALPHABET, min_size=1, max_size=12)


def _perturb_ws(text: str, repl: str) -> str:
    return text.replace(" ", repl)


@st.composite
def _para_quote(draw: st.DrawFn) -> tuple[str, str]:
    """Paragraph plus a query: a (possibly re-cased / re-spaced) substring or random text."""
    para = draw(_paragraph)
    if draw(st.integers(min_value=0, max_value=3)) == 0:
        return para, draw(_random_quote)
    i = draw(st.integers(min_value=0, max_value=len(para) - 1))
    j = draw(st.integers(min_value=i + 1, max_value=len(para)))
    quote = para[i:j]
    variant = draw(st.sampled_from(["keep", "lower", "upper", "swapcase", "ws"]))
    if variant == "ws":
        quote = _perturb_ws(quote, draw(st.sampled_from(["  ", " \n", "\t"])))
    elif variant != "keep":
        quote = getattr(quote, variant)()
    return para, quote


@st.composite
def _letter_swapped_for_quote(draw: st.DrawFn) -> tuple[str, str]:
    """Substring of a paragraph with one letter replaced by a quote-class member."""
    para = draw(st.text(alphabet="abcXYZ ,.", min_size=2, max_size=40))
    letters = [k for k, ch in enumerate(para) if ch.isalpha()]
    assume(letters)
    pos = draw(st.sampled_from(letters))
    lo = draw(st.integers(min_value=0, max_value=pos))
    hi = draw(st.integers(min_value=pos + 1, max_value=len(para)))
    quote = para[lo:pos] + draw(st.sampled_from(_QUOTE_MEMBERS)) + para[pos + 1:hi]
    return para, quote


# --------------------------------------------------------------------------- #
# 3.1 / 3.2 / 3.3 - matched inputs are identical to the frozen original       #
# --------------------------------------------------------------------------- #


@wren_settings()
@given(_para_quote())
def test_property_matched_inputs_identical_to_original(data: tuple[str, str]) -> None:
    """Exact, case-insensitive and whitespace-normalized matches are unchanged.

    **Validates: Requirements 3.1, 3.2, 3.3**
    """
    para_text, model_quote = data
    expected = locate_original(para_text, model_quote)
    assume(expected is not None)  # matched today => not in C
    assert locate(para_text, model_quote) == expected


@wren_settings()
@given(_para_quote())
def test_property_insert_rows_and_fingerprint_match_original(data: tuple[str, str]) -> None:
    """Persisted quoted_text, anchor offsets, content_fingerprint and log are unchanged.

    **Validates: Requirements 3.1, 3.2, 3.3, 3.7**
    """
    para_text, model_quote = data
    expected = locate_original(para_text, model_quote)
    assume(expected is not None)
    start, end, method = expected

    conn, logs, count = _insert(
        [_item({"paragraphIndex": 0, "quotedText": model_quote})], [{"text": para_text}]
    )

    assert count == 1
    assert _expected_success_log("inline", 0, start, end, method) in logs
    item_rows = conn.inserts("feedback_item")
    assert len(item_rows) == 1
    assert item_rows[0][5] == para_text[start:end]
    anchor_rows = conn.inserts("anchor")
    assert len(anchor_rows) == 1
    _aid, _fid, draft_id, para_index, a_start, a_end, content_fp = anchor_rows[0]
    assert (draft_id, para_index, a_start, a_end) == ("draft-1", 0, start, end)
    assert content_fp == handler.compute_content_fingerprint(para_text, start, end)


# --------------------------------------------------------------------------- #
# 3.4 / 3.5 / 3.6 - genuine misses still fail                                 #
# --------------------------------------------------------------------------- #


def _assert_persisted_as_miss(
    para_text: str, model_quote: str, segments: list[dict[str, Any]], para_index: int = 0,
) -> None:
    conn, logs, count = _insert(
        [_item({"paragraphIndex": para_index, "quotedText": model_quote})], segments
    )
    assert count == 1
    assert _expected_failure_log("inline", para_index, model_quote, para_text) in logs
    assert not any(m.startswith("Anchor matched") for m in logs)
    item_rows = conn.inserts("feedback_item")
    assert len(item_rows) == 1
    assert item_rows[0][5] == model_quote
    assert conn.inserts("anchor") == []


@wren_settings()
@given(_para_quote())
def test_property_genuine_misses_still_fail(data: tuple[str, str]) -> None:
    """Quotes absent even after fold fail, log, and store the model quote.

    **Validates: Requirements 3.4**
    """
    para_text, model_quote = data
    assume(locate_original(para_text, model_quote) is None)
    assume(not is_bug_condition(para_text, model_quote))
    assert locate(para_text, model_quote) is None
    _assert_persisted_as_miss(para_text, model_quote, [{"text": para_text}])


@wren_settings()
@given(_letter_swapped_for_quote())
def test_property_quote_substituted_for_letter_still_fails(data: tuple[str, str]) -> None:
    """An apostrophe/quote where the paragraph has a letter never matches.

    **Validates: Requirements 3.5**
    """
    para_text, model_quote = data
    assume(locate_original(para_text, model_quote) is None)
    assume(not is_bug_condition(para_text, model_quote))
    assert locate(para_text, model_quote) is None
    _assert_persisted_as_miss(para_text, model_quote, [{"text": para_text}])


# Whitespace is deliberately excluded: it is not a character class this
# property is about, and step 3 (_fuzzy_find) legitimately strips it.
_ISOLATION_CHARS = _QUOTE_MEMBERS + tuple("aZ0-`") + ("\u00b4", "\u02bc", "\u2035", "\u00ab", "\u00bb")


@st.composite
def _cross_class_pair(draw: st.DrawFn) -> tuple[str, str]:
    a = draw(st.sampled_from(_ISOLATION_CHARS))
    b = draw(st.sampled_from(_ISOLATION_CHARS))
    assume(a in _QUOTE_MEMBERS or b in _QUOTE_MEMBERS)
    assume(_quote_class(a) != _quote_class(b))
    left = draw(st.text(alphabet="abcXYZ", min_size=0, max_size=6))
    right = draw(st.text(alphabet="abcXYZ", min_size=0, max_size=6))
    return left + a + right, left + b + right


@wren_settings()
@given(_cross_class_pair())
def test_property_class_isolation(data: tuple[str, str]) -> None:
    """A quote char never matches a char from another class or a non-quote char.

    **Validates: Requirements 3.5**
    """
    para_text, model_quote = data
    # Isolation is only meaningful for pairs the original matcher misses.
    assume(locate_original(para_text, model_quote) is None)
    assert not is_bug_condition(para_text, model_quote)
    assert locate(para_text, model_quote) is None


@wren_settings()
@given(_paragraph, _paragraph, st.data())
def test_property_other_paragraph_not_searched(
    para0: str, para1: str, data: st.DataObject,
) -> None:
    """A quote from paragraph 1 is not found when the model names paragraph 0.

    **Validates: Requirements 3.6**
    """
    i = data.draw(st.integers(min_value=0, max_value=len(para1) - 1))
    j = data.draw(st.integers(min_value=i + 1, max_value=len(para1)))
    quote = para1[i:j]
    assume(locate_original(para0, quote) is None)
    assume(not is_bug_condition(para0, quote))
    assert locate(para0, quote) is None
    _assert_persisted_as_miss(para0, quote, [{"text": para0}, {"text": para1}], para_index=0)


# Concrete edge cases from the design.

def test_apostrophe_never_matches_letter() -> None:
    para_text = "The investigator found that Fionas conduct was consistent with the policy."
    quote = "Fiona's conduct"
    assert not is_bug_condition(para_text, quote)
    assert locate(para_text, quote) is None
    _assert_persisted_as_miss(para_text, quote, [{"text": para_text}])


def test_heading_paragraph_miss_does_not_search_next_paragraph() -> None:
    heading = "Acknowledgements"
    body = "Acknowledgements are owed to my supervisor for her guidance."
    quote = "Acknowledgements are owed to"
    assert not is_bug_condition(heading, quote)
    assert locate(heading, quote) is None
    _assert_persisted_as_miss(heading, quote, [{"text": heading}, {"text": body}], para_index=0)


# --------------------------------------------------------------------------- #
# 3.8 - out-of-range paragraph, empty quotedText, missing anchor              #
# --------------------------------------------------------------------------- #


def test_out_of_range_paragraph_index_unchanged() -> None:
    conn, logs, count = _insert(
        [_item({"paragraphIndex": 3, "quotedText": "Fiona's conduct"})],
        [{"text": "Fiona\u2019s conduct was fine."}],
    )
    assert count == 1
    assert "Anchor paragraphIndex=3 out of range (segments=1)" in logs
    assert not any(m.startswith("Anchor match") for m in logs)
    assert [r[5] for r in conn.inserts("feedback_item")] == ["Fiona's conduct"]
    assert conn.inserts("anchor") == []


def test_empty_quoted_text_unchanged() -> None:
    conn, logs, count = _insert(
        [_item({"paragraphIndex": 0, "quotedText": ""})],
        [{"text": "Fiona\u2019s conduct was fine."}],
    )
    assert count == 1
    assert "Inline item missing quotedText in anchor" in logs
    assert [r[5] for r in conn.inserts("feedback_item")] == [None]
    assert conn.inserts("anchor") == []


def test_missing_anchor_unchanged() -> None:
    # Observed on unfixed code: the feedback_item INSERT is issued, then the
    # anchor block reads an unbound ``anchor_data`` and the per-item handler
    # logs "Failed to insert feedback item" without counting the item.
    conn, logs, count = _insert([_item(None)], [{"text": "Fiona\u2019s conduct was fine."}])
    assert "Inline item missing anchor field entirely" in logs
    assert [r[5] for r in conn.inserts("feedback_item")] == [None]
    assert conn.inserts("anchor") == []
    assert count == 0
    assert any(m.startswith("Failed to insert feedback item") for m in logs)


def test_strength_out_of_range_unchanged() -> None:
    conn, logs, count = _insert(
        [_item({"paragraphIndex": 5, "quotedText": "Fiona's conduct"}, kind="strength")],
        [{"text": "Fiona\u2019s conduct was fine."}],
    )
    assert count == 1
    assert not any("out of range" in m or m.startswith("Anchor match") for m in logs)
    assert [r[5] for r in conn.inserts("feedback_item")] == [None]
    assert conn.inserts("anchor") == []


def test_fold_helper_sanity() -> None:
    """The shared test-local fold is the 1:1 table from the design."""
    src = "".join(_QUOTE_MEMBERS) + "abc"
    assert fold(src) == "'" * len(_SINGLE) + '"' * len(_DOUBLE) + "abc"
    assert len(fold(src)) == len(src)
