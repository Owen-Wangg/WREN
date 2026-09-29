"""Integration test: one insert_feedback_items batch with typographic anchors.

Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 4.1).

A single batch mixes four inline items and runs through the real
``handler.insert_feedback_items`` with a fake psycopg connection that records
``execute`` calls:

- exact:        quote copied verbatim from paragraph 0
- typographic:  straight-apostrophe quote against a curly-apostrophe paragraph 1
- genuine miss: quote named against the heading paragraph 2; the text only
                exists in paragraph 3, which must NOT be searched (3.6)
- out of range: paragraphIndex beyond the segment list

The typographic item's persisted values are pinned to the shared JSON fixture
``backend/feedback/src/__fixtures__/typographicAnchorRoundTrip.json``, which the
engine -> API round-trip test (task 4.2) feeds into ``resolveQuotedTextForItem``.

**Validates: Requirements 2.1, 2.3, 3.1, 3.4, 3.7, 3.8**
"""
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler  # noqa: E402
from test_anchor_typographic_bug_condition import _FakeConn  # noqa: E402

_FIXTURE_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..",
    "feedback", "src", "__fixtures__", "typographicAnchorRoundTrip.json",
))

with open(_FIXTURE_PATH, encoding="utf-8") as fh:
    FIXTURE: dict[str, Any] = json.load(fh)

SEGMENTS = [{"text": t} for t in FIXTURE["segments"]]

EXACT_QUOTE = "the email was sent"
MISS_QUOTE = "Acknowledgements are owed to"
OUT_OF_RANGE_QUOTE = "a sentence from nowhere"
OUT_OF_RANGE_INDEX = 7


def _inline(para_index: int, quote: str, question: str) -> dict[str, Any]:
    return {
        "kind": "inline",
        "error_category_id": "cat-1",
        "question_text": question,
        "anchor": {"paragraphIndex": para_index, "quotedText": quote},
    }


@pytest.fixture
def batch(caplog: pytest.LogCaptureFixture) -> tuple[_FakeConn, str]:
    caplog.set_level(logging.INFO)
    items = [
        _inline(0, EXACT_QUOTE, "q-exact"),
        _inline(FIXTURE["paragraphIndex"], FIXTURE["modelQuote"], "q-typographic"),
        _inline(2, MISS_QUOTE, "q-miss"),
        _inline(OUT_OF_RANGE_INDEX, OUT_OF_RANGE_QUOTE, "q-out-of-range"),
    ]
    conn = _FakeConn()
    count = handler.insert_feedback_items(
        "doc-1", "draft-1", "user-1", items, SEGMENTS, conn, wipe_existing=False,
    )
    assert count == 4
    assert conn.committed
    return conn, caplog.text


def _items_by_question(conn: _FakeConn) -> dict[str, tuple[Any, ...]]:
    # feedback_item params: (id, document_id, error_category_id, kind,
    #                        question_text, quoted_text, positive_note, source_draft_id)
    return {row[4]: row for row in conn.inserts("feedback_item")}


def _anchors_by_feedback_id(conn: _FakeConn) -> dict[str, tuple[Any, ...]]:
    # anchor params: (id, feedback_item_id, draft_id, paragraph_index,
    #                 start_offset, end_offset, content_fingerprint)
    return {row[1]: row for row in conn.inserts("anchor")}


def test_fixture_is_self_consistent() -> None:
    para = FIXTURE["segments"][FIXTURE["paragraphIndex"]]
    assert para == FIXTURE["paragraphText"]
    assert para[FIXTURE["startOffset"]:FIXTURE["endOffset"]] == FIXTURE["quotedText"]
    assert "\u2019" in FIXTURE["quotedText"]
    assert FIXTURE["modelQuote"] not in para  # straight quote is not in the paragraph
    assert FIXTURE["contentFingerprint"] == handler.compute_content_fingerprint(
        para, FIXTURE["startOffset"], FIXTURE["endOffset"]
    )


def test_batch_quoted_text_values(batch: tuple[_FakeConn, str]) -> None:
    conn, _ = batch
    rows = _items_by_question(conn)
    assert set(rows) == {"q-exact", "q-typographic", "q-miss", "q-out-of-range"}

    assert rows["q-exact"][5] == EXACT_QUOTE
    # Typographic item stores the paragraph's curly characters, not the model's text.
    assert rows["q-typographic"][5] == FIXTURE["quotedText"]
    assert rows["q-typographic"][5] != FIXTURE["modelQuote"]
    # Genuine miss and out-of-range items keep the model's text for the TS resolver.
    assert rows["q-miss"][5] == MISS_QUOTE
    assert rows["q-out-of-range"][5] == OUT_OF_RANGE_QUOTE


def test_batch_anchor_rows(batch: tuple[_FakeConn, str]) -> None:
    conn, _ = batch
    rows = _items_by_question(conn)
    anchors = _anchors_by_feedback_id(conn)

    exact_id = rows["q-exact"][0]
    typo_id = rows["q-typographic"][0]
    assert set(anchors) == {exact_id, typo_id}
    assert rows["q-miss"][0] not in anchors
    assert rows["q-out-of-range"][0] not in anchors

    exact_para = FIXTURE["segments"][0]
    exact_start = exact_para.index(EXACT_QUOTE)
    exact_end = exact_start + len(EXACT_QUOTE)
    _aid, _fid, draft_id, para_index, start, end, fp = anchors[exact_id]
    assert (draft_id, para_index, start, end) == ("draft-1", 0, exact_start, exact_end)
    assert (start, end) == (24, 42)
    assert fp == handler.compute_content_fingerprint(exact_para, start, end)

    _aid, _fid, draft_id, para_index, start, end, fp = anchors[typo_id]
    assert (draft_id, para_index) == ("draft-1", FIXTURE["paragraphIndex"])
    assert (start, end) == (FIXTURE["startOffset"], FIXTURE["endOffset"])
    assert fp == FIXTURE["contentFingerprint"]

    # current_anchor_id is back-filled for anchored items only.
    updates = [
        p for sql, p in conn.calls
        if sql.startswith("UPDATE feedback_item SET current_anchor_id")
    ]
    assert sorted(updates) == sorted([
        (anchors[exact_id][0], exact_id),
        (anchors[typo_id][0], typo_id),
    ])


def test_batch_logs(batch: tuple[_FakeConn, str]) -> None:
    _, log_text = batch
    assert "Anchor matched (exact) kind=inline para=0 offsets=24:42" in log_text
    assert (
        f"Anchor matched (typographic) kind=inline para={FIXTURE['paragraphIndex']} "
        f"offsets={FIXTURE['startOffset']}:{FIXTURE['endOffset']}"
    ) in log_text
    assert log_text.count("Anchor match FAILED") == 1
    assert "Anchor match FAILED kind=inline para=2" in log_text
    assert (
        f"Anchor paragraphIndex={OUT_OF_RANGE_INDEX} out of range "
        f"(segments={len(SEGMENTS)})"
    ) in log_text
