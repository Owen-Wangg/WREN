"""Tests for the defense-in-depth footnote-body caps (finding f-ca2d70a5).

The Node write gate now counts footnote bodies, but the Feedback Engine must
not assume the gate ran — a stored draft could predate the fix. These tests
cover the per-footnote and aggregate character caps applied when assembling the
FOOTNOTES/CITATIONS block, the telemetry emitted on truncation, and the no-op
(within-cap) case that must stay byte-for-byte identical.
"""
import json

from wren_engine.footnote_metadata import (
    FootnoteMetadata,
    MAX_FOOTNOTE_CONTENT_CHARS,
    MAX_FOOTNOTES_TOTAL_CHARS,
    MAX_FOOTNOTE_METADATA_FIELD_CHARS,
    MAX_FOOTNOTES_RENDERED,
    MAX_FOOTNOTE_NUMBER,
    FOOTNOTE_CAP_EMF_NAMESPACE,
    build_footnotes_untrusted_content,
)


def _collect_sink():
    """A telemetry sink that captures emitted EMF lines."""
    lines: list[str] = []
    return lines, lines.append


class TestPerFootnoteCap:
    def test_oversized_body_is_truncated_with_ellipsis(self):
        oversized = "x" * (MAX_FOOTNOTE_CONTENT_CHARS + 500)
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(
            [FootnoteMetadata(footnote_number=1, content=oversized)],
            sink=sink,
        )
        assert result is not None
        # The body kept at most the per-footnote cap plus the ellipsis marker.
        assert "…" in result.text
        # The full oversized body must NOT appear verbatim.
        assert oversized not in result.text
        # Exactly the cap's worth of body characters survive (plus "[1] " and "…").
        kept_body = result.text[len("[1] ") :].rstrip("…")
        assert len(kept_body) == MAX_FOOTNOTE_CONTENT_CHARS

    def test_truncation_emits_warning_metric(self):
        oversized = "x" * (MAX_FOOTNOTE_CONTENT_CHARS + 1)
        lines, sink = _collect_sink()
        build_footnotes_untrusted_content(
            [FootnoteMetadata(footnote_number=1, content=oversized)],
            sink=sink,
        )
        assert len(lines) == 1
        event = json.loads(lines[0])
        assert event["FootnoteCapApplied"] == 1
        assert event["FootnotesTruncated"] == 1
        assert event["FootnoteCharsOmitted"] >= 1
        namespace = event["_aws"]["CloudWatchMetrics"][0]["Namespace"]
        assert namespace == FOOTNOTE_CAP_EMF_NAMESPACE


class TestAggregateCap:
    def test_total_budget_truncates_later_footnotes(self):
        # Each body is at the per-footnote cap; enough of them to blow the
        # aggregate budget several times over.
        per = MAX_FOOTNOTE_CONTENT_CHARS
        count = (MAX_FOOTNOTES_TOTAL_CHARS // per) + 3
        footnotes = [
            FootnoteMetadata(footnote_number=i + 1, content="y" * per)
            for i in range(count)
        ]
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(footnotes, sink=sink)
        assert result is not None
        # Total kept body characters never exceed the aggregate budget.
        kept_body_chars = sum(
            len(line.split("] ", 1)[1].rstrip("…"))
            for line in result.text.split("\n")
            if "] " in line
        )
        assert kept_body_chars <= MAX_FOOTNOTES_TOTAL_CHARS
        # Telemetry fired for the aggregate truncation.
        assert len(lines) == 1


class TestMetadataCap:
    def test_oversized_metadata_field_is_truncated(self):
        oversized_author = "a" * (MAX_FOOTNOTE_METADATA_FIELD_CHARS + 100)
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(
            [
                FootnoteMetadata(
                    footnote_number=1, content="short", author=oversized_author
                )
            ],
            sink=sink,
        )
        assert result is not None
        # The full oversized metadata value must not appear verbatim.
        assert oversized_author not in result.text
        assert "…" in result.text
        # Telemetry fired for the metadata truncation.
        assert len(lines) == 1
        event = json.loads(lines[0])
        assert event["FootnotesTruncated"] == 1

    def test_metadata_is_charged_against_aggregate_budget(self):
        # Many footnotes each carrying max-length metadata in every field: the
        # per-field cap alone would allow ~count*5*500 chars, but the aggregate
        # budget must bound the total attacker-controlled text (f-de6a04f5).
        field = "m" * MAX_FOOTNOTE_METADATA_FIELD_CHARS
        count = (MAX_FOOTNOTES_TOTAL_CHARS // MAX_FOOTNOTE_METADATA_FIELD_CHARS) + 50
        footnotes = [
            FootnoteMetadata(
                footnote_number=i + 1,
                content="",
                author=field,
                title=field,
                source=field,
                pinpoint=field,
                year=field,
            )
            for i in range(count)
        ]
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(footnotes, sink=sink)
        assert result is not None
        # Sum the attacker-controlled metadata chars actually rendered (strip
        # the "(field: ...)" wrappers and structural "[N]" prefixes).
        import re

        rendered_meta_chars = sum(
            len(m.rstrip("…"))
            for m in re.findall(r"\((?:author|title|source|pinpoint|year): ([^)]*)\)", result.text)
        )
        assert rendered_meta_chars <= MAX_FOOTNOTES_TOTAL_CHARS
        assert len(lines) == 1

    def test_small_metadata_is_rendered_verbatim(self):
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(
            [
                FootnoteMetadata(
                    footnote_number=1,
                    content="body",
                    author="Jane",
                    year="2026",
                )
            ],
            sink=sink,
        )
        assert result is not None
        assert "(author: Jane)" in result.text
        assert "(year: 2026)" in result.text
        assert lines == []


class TestFootnoteCountCap:
    def test_excess_footnotes_are_dropped_with_telemetry(self):
        count = MAX_FOOTNOTES_RENDERED + 25
        footnotes = [
            FootnoteMetadata(footnote_number=i + 1, content="x") for i in range(count)
        ]
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(footnotes, sink=sink)
        assert result is not None
        # Only MAX_FOOTNOTES_RENDERED lines are emitted.
        assert len(result.text.split("\n")) == MAX_FOOTNOTES_RENDERED
        assert len(lines) == 1
        event = json.loads(lines[0])
        assert event["FootnotesDropped"] == 25


class TestFootnoteNumberBound:
    def test_absurd_footnote_number_is_dropped(self):
        # A ~309-digit number (as from a float round-trip) must not be rendered
        # as hundreds of digits (finding f-b4f8ddb1).
        huge = int("9" * 309)
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(
            [
                FootnoteMetadata(footnote_number=huge, content="body"),
                FootnoteMetadata(footnote_number=2, content="kept"),
            ],
            sink=sink,
        )
        assert result is not None
        # The absurd number is not rendered; the valid footnote survives.
        assert "9" * 309 not in result.text
        assert "[2] kept" in result.text
        event = json.loads(lines[0])
        assert event["FootnotesDropped"] == 1

    def test_number_at_bound_is_kept(self):
        result = build_footnotes_untrusted_content(
            [FootnoteMetadata(footnote_number=MAX_FOOTNOTE_NUMBER, content="ok")]
        )
        assert result is not None
        assert f"[{MAX_FOOTNOTE_NUMBER}] ok" in result.text


class TestWithinCapNoOp:
    def test_small_footnotes_are_unchanged_and_emit_no_telemetry(self):
        footnotes = [
            FootnoteMetadata(footnote_number=1, content="short note one"),
            FootnoteMetadata(
                footnote_number=2, content="short note two", author="Doe"
            ),
        ]
        lines, sink = _collect_sink()
        result = build_footnotes_untrusted_content(footnotes, sink=sink)
        assert result is not None
        # Bodies survive verbatim; no ellipsis, no telemetry.
        assert "short note one" in result.text
        assert "short note two" in result.text
        assert "(author: Doe)" in result.text
        assert "…" not in result.text
        assert lines == []

    def test_empty_list_returns_none(self):
        assert build_footnotes_untrusted_content([]) is None
