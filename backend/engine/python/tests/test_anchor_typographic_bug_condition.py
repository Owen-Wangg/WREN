"""Bug condition exploration tests: typographic quote anchor matching.

Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 1).

Property 1: Bug Condition - Typographic quote variants anchor to the original
paragraph span.

For any (para_text, model_quote) where ``is_bug_condition`` holds (the
existing exact / case-insensitive / whitespace-normalized steps all miss, but
they would match after folding typographic quotes to their straight forms),
the matcher must return an in-bounds span of the ORIGINAL paragraph whose
folded, whitespace-normalized, lowercased text equals the folded quote, and
``insert_feedback_items`` must persist that span (curly characters included)
plus an anchor row with the matching content fingerprint.

These tests are EXPECTED TO FAIL on the unfixed code: failure confirms the bug.

Matcher-level assertions go through ``locate``: it calls
``handler._locate_quote_in_paragraph`` when present (after the fix) and
otherwise reproduces the current inline steps 1-3 of ``insert_feedback_items``.
End-to-end assertions call the real ``handler.insert_feedback_items`` with a
fake psycopg connection that records ``execute`` calls.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 (expected: 2.1, 2.2, 2.3)**
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from wren_testing import wren_settings  # noqa: E402


# --------------------------------------------------------------------------- #
# Fold + frozen original matcher                                              #
# --------------------------------------------------------------------------- #

_SINGLE_CLASS = ("\u2018", "\u2019", "\u201A", "\u201B", "\u2032")
_DOUBLE_CLASS = ("\u201C", "\u201D", "\u201E", "\u201F", "\u2033")
_FOLD_TABLE = str.maketrans(
    {**{c: "'" for c in _SINGLE_CLASS}, **{c: '"' for c in _DOUBLE_CLASS}}
)
TYPOGRAPHIC_METHODS = {
    "typographic",
    "typographic-case-insensitive",
    "typographic-fuzzy-whitespace",
}


def fold(text: str) -> str:
    """Test-local 1:1 typographic quote fold (same table as the design)."""
    return text.translate(_FOLD_TABLE)


def norm_ws(text: str) -> str:
    return handler._normalize_whitespace(text)


def _original_fuzzy_end(para_text: str, start_offset: int, norm_len: int) -> int:
    """Verbatim copy of the step-3 end-offset walk in insert_feedback_items."""
    count = 0
    end_pos = start_offset
    in_space = False
    for j in range(start_offset, len(para_text)):
        ch = para_text[j]
        if ch in (' ', '\t', '\n', '\r', '\xa0'):
            if not in_space:
                count += 1
                in_space = True
        else:
            count += 1
            in_space = False
        if count >= norm_len:
            end_pos = j + 1
            break
    else:
        end_pos = len(para_text)
    return end_pos


def locate_original(para_text: str, model_quote: str) -> tuple[int, int, str] | None:
    """Frozen copy of the unfixed three-step matcher (exact, case, whitespace)."""
    start_offset = para_text.find(model_quote)
    match_method = 'exact' if start_offset != -1 else None
    if start_offset == -1:
        start_offset = para_text.lower().find(model_quote.lower())
        if start_offset != -1:
            match_method = 'case-insensitive'
            model_quote = para_text[start_offset:start_offset + len(model_quote)]
    if start_offset == -1:
        start_offset = handler._fuzzy_find(para_text, model_quote)
        if start_offset != -1:
            match_method = 'fuzzy-whitespace'
            norm_len = len(handler._normalize_whitespace(model_quote))
            end_pos = _original_fuzzy_end(para_text, start_offset, norm_len)
            model_quote = para_text[start_offset:end_pos]
    if start_offset == -1:
        return None
    return start_offset, start_offset + len(model_quote), match_method  # type: ignore[return-value]


def locate(para_text: str, model_quote: str) -> tuple[int, int, str] | None:
    """Subject under test: the fixed matcher when present, else current inline steps."""
    fixed = getattr(handler, '_locate_quote_in_paragraph', None)
    if fixed is not None:
        return fixed(para_text, model_quote)
    return locate_original(para_text, model_quote)


def is_bug_condition(para_text: str, model_quote: str) -> bool:
    return (
        model_quote != ''
        and locate_original(para_text, model_quote) is None
        and locate_original(fold(para_text), fold(model_quote)) is not None
    )


def assert_expected_behavior(para_text: str, model_quote: str) -> tuple[int, int, str]:
    result = locate(para_text, model_quote)
    assert result is not None, (
        f"no match for quote={model_quote!r} in para={para_text!r}"
    )
    start, end, method = result
    assert 0 <= start < end <= len(para_text), (start, end, len(para_text))
    assert norm_ws(fold(para_text[start:end])).lower() == norm_ws(fold(model_quote)).lower()
    assert method in TYPOGRAPHIC_METHODS, method
    return start, end, method


# --------------------------------------------------------------------------- #
# Fake psycopg connection                                                     #
# --------------------------------------------------------------------------- #


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
        self.committed = False

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self.calls)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        pass

    def inserts(self, table: str) -> list[tuple[Any, ...]]:
        prefix = f"INSERT INTO {table} "
        return [p for sql, p in self.calls if sql.startswith(prefix)]


def _run_insert(para_text: str, model_quote: str) -> _FakeConn:
    conn = _FakeConn()
    item = {
        'kind': 'inline',
        'error_category_id': 'cat-1',
        'question_text': 'What does this show?',
        'anchor': {'paragraphIndex': 0, 'quotedText': model_quote},
    }
    count = handler.insert_feedback_items(
        'doc-1', 'draft-1', 'user-1', [item], [{'text': para_text}], conn,
        wipe_existing=False,
    )
    assert count == 1
    return conn


# --------------------------------------------------------------------------- #
# Concrete cases from wren-dev "Anchor match FAILED" logs                     #
# --------------------------------------------------------------------------- #

# (para_text, model_quote, expected_start, expected_quoted_text, expected_method)
_LOG_CASES = [
    pytest.param(
        "The investigator found that Fiona\u2019s conduct was consistent with the policy.",
        "Fiona's conduct",
        28,
        "Fiona\u2019s conduct",
        "typographic",
        id="apostrophe",
    ),
    pytest.param(
        "The complainant must prove \u201cthe prohibited conduct\u201d occurred on the balance of probabilities.",
        'prove "the prohibited conduct',
        21,
        "prove \u201cthe prohibited conduct",
        "typographic",
        id="opening-double-quote",
    ),
    pytest.param(
        "The tribunal described the respondent \u201c[w]atching the complainant\u201d for weeks.",
        '"[w]atching',
        38,
        "\u201c[w]atching",
        "typographic",
        id="bracketed-opening-quote",
    ),
    pytest.param(
        "5.The generated files \u201cproject_details\u201d and \u201csummary\u201d are stored in S3.",
        'The generated files "project_details"',
        2,
        "The generated files \u201cproject_details\u201d",
        "typographic",
        id="paired-quotes-numbered-prefix",
    ),
    pytest.param(
        "However, \u201cthe perspective of the complainant\u201d is not determinative.",
        'however,  "the perspective of the complainant"',
        0,
        "However, \u201cthe perspective of the complainant\u201d",
        "typographic-fuzzy-whitespace",
        id="combined-case-and-whitespace",
    ),
]


@pytest.mark.parametrize(
    "para_text, model_quote, expected_start, expected_quoted, expected_method", _LOG_CASES
)
def test_log_case_is_bug_condition(
    para_text: str, model_quote: str, expected_start: int, expected_quoted: str,
    expected_method: str,
) -> None:
    """Sanity: each log pair really is in C (the frozen original misses it)."""
    assert is_bug_condition(para_text, model_quote)


@pytest.mark.parametrize(
    "para_text, model_quote, expected_start, expected_quoted, expected_method", _LOG_CASES
)
def test_matcher_locates_typographic_variant(
    para_text: str, model_quote: str, expected_start: int, expected_quoted: str,
    expected_method: str,
) -> None:
    start, end, method = assert_expected_behavior(para_text, model_quote)
    assert start == expected_start
    assert para_text[start:end] == expected_quoted
    assert method == expected_method


@pytest.mark.parametrize(
    "para_text, model_quote, expected_start, expected_quoted, expected_method", _LOG_CASES
)
def test_insert_feedback_items_persists_original_span(
    para_text: str, model_quote: str, expected_start: int, expected_quoted: str,
    expected_method: str, caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    conn = _run_insert(para_text, model_quote)

    assert "Anchor match FAILED" not in caplog.text

    item_rows = conn.inserts("feedback_item")
    assert len(item_rows) == 1
    stored_quoted_text = item_rows[0][5]
    assert stored_quoted_text == expected_quoted, (
        f"stored quoted_text={stored_quoted_text!r}, expected paragraph original "
        f"characters {expected_quoted!r}"
    )

    anchor_rows = conn.inserts("anchor")
    assert len(anchor_rows) == 1, "no anchor row persisted"
    _aid, _fid, draft_id, para_index, start, end, content_fp = anchor_rows[0]
    assert (draft_id, para_index) == ("draft-1", 0)
    assert start == expected_start
    assert end == expected_start + len(expected_quoted)
    assert content_fp == handler.compute_content_fingerprint(para_text, start, end)


# --------------------------------------------------------------------------- #
# Hypothesis property over generated inputs in C                              #
# --------------------------------------------------------------------------- #

_PLAIN_CHARS = "abcdeFGHIJklmnoXYZ,.;:()[]-'\""
_QUOTE_CHARS = _SINGLE_CLASS + _DOUBLE_CLASS

_plain_word = st.text(alphabet=_PLAIN_CHARS, min_size=1, max_size=7)
_words = st.lists(_plain_word, min_size=0, max_size=4)


@st.composite
def _bug_input(draw: st.DrawFn) -> tuple[str, str]:
    """Paragraph with a curly quote inside a chosen span; query = folded span.

    The paragraph never starts with whitespace (keeps clear of the existing
    ``_fuzzy_find`` leading-whitespace quirk, which is out of scope here).
    """
    prefix = draw(_words)
    span = draw(st.lists(_plain_word, min_size=1, max_size=5))
    suffix = draw(_words)

    # Put at least one typographic quote into the span.
    for _ in range(draw(st.integers(min_value=1, max_value=3))):
        wi = draw(st.integers(min_value=0, max_value=len(span) - 1))
        word = span[wi]
        ci = draw(st.integers(min_value=0, max_value=len(word)))
        span[wi] = word[:ci] + draw(st.sampled_from(_QUOTE_CHARS)) + word[ci:]

    sep = draw(st.sampled_from([" ", "  "]))
    span_text = sep.join(span)
    para_text = " ".join(prefix + [span_text] + suffix)

    query = fold(span_text)
    case = draw(st.sampled_from(["keep", "lower", "upper", "swapcase"]))
    if case != "keep":
        query = getattr(query, case)()
    if draw(st.booleans()):
        query = query.replace(" ", draw(st.sampled_from(["  ", " \n", "\t"])))
    return para_text, query


@wren_settings()
@given(_bug_input())
def test_property_typographic_variants_anchor_to_original_span(
    data: tuple[str, str],
) -> None:
    """Property 1: Bug Condition.

    **Validates: Requirements 2.1, 2.2, 2.3**
    """
    para_text, model_quote = data
    assume(is_bug_condition(para_text, model_quote))
    assert_expected_behavior(para_text, model_quote)
