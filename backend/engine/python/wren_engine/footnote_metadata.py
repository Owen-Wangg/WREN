"""Footnote/citation metadata for the WREN Feedback Engine (Task 9.1).

Builds the ``FOOTNOTES/CITATIONS`` :class:`~wren_engine.prompt_assembly.UntrustedContent`
block from footnote data extracted on the Node side (`extractFootnotes` in
`@wren/types`) and passed through with the Draft payload — the Python
Feedback Engine never imports the TypeScript extraction function directly;
it receives the equivalent plain JSON array over the process boundary the
same way `segments` already crosses Node -> Python today.

Pure, deterministic, dependency-free (mirrors `prompt_assembly.py` and
`diff_engine.py`'s style: dataclass-based, no cloud calls).

Design references:
  - `.kiro/specs/footnote-citation-support/design.md` "Feedback Engine
    integration (Python)".
  - Requirements 5.1, 5.2, 5.3, 5.6.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Callable, Optional

from .prompt_assembly import UntrustedContent

__all__ = [
    "FootnoteMetadata",
    "MAX_FOOTNOTE_CONTENT_CHARS",
    "MAX_FOOTNOTES_TOTAL_CHARS",
    "MAX_FOOTNOTE_METADATA_FIELD_CHARS",
    "MAX_FOOTNOTES_RENDERED",
    "MAX_FOOTNOTE_NUMBER",
    "FOOTNOTE_CAP_EMF_NAMESPACE",
    "build_footnotes_untrusted_content",
]

logger = logging.getLogger(__name__)

# Defense-in-depth caps on footnote text appended to the Bedrock prompt
# (findings f-ca2d70a5, f-4d906a98). The Node write gate now counts footnote
# bodies and metadata, but the engine must not assume the gate was applied: a
# stored draft could predate the fix. We bound each footnote body and the
# aggregate, each citation metadata field, and the number of footnotes rendered
# so a draft that slipped past the gate cannot inflate the prompt without bound.
# The per-file reference caps in ``debrief_budget`` (4k/12k chars) are the model
# for the body values.
MAX_FOOTNOTE_CONTENT_CHARS = 2_000
# Aggregate ceiling on ALL attacker-controlled footnote text — bodies AND
# citation metadata values combined — charged against a single running budget
# (finding f-de6a04f5). Without charging metadata here, per-field caps alone let
# ~500 footnotes × 5 fields × 500 chars reach the prompt; this bounds the total.
MAX_FOOTNOTES_TOTAL_CHARS = 12_000
# Each citation metadata field (author/title/source/pinpoint/year) is rendered
# verbatim; cap each one so a single field cannot amplify the prompt
# (f-4d906a98). The aggregate budget above bounds the sum across all fields.
MAX_FOOTNOTE_METADATA_FIELD_CHARS = 500
# Upper bound on how many footnotes are rendered into the block at all, so the
# footnote COUNT cannot amplify the prompt even when each one is small.
MAX_FOOTNOTES_RENDERED = 500
# Upper bound on a footnote NUMBER. Real footnote numbers are small sequential
# integers; a stored draft could carry a huge numeric ``footnoteNumber`` (e.g.
# a ~309-digit value from a float round-trip) that is rendered verbatim as
# decimal digits, so bound the magnitude to keep each rendered number to a few
# digits (finding f-b4f8ddb1). Footnotes outside ``(0, MAX_FOOTNOTE_NUMBER]``
# are dropped from the rendered block.
MAX_FOOTNOTE_NUMBER = 100_000

# EMF namespace for Feedback Engine prompt-assembly metrics (matches
# ``debrief_budget.REFERENCE_CAP_EMF_NAMESPACE``). Only ``workload`` is a
# dimension: no user, document, draft, department, or job identifiers.
FOOTNOTE_CAP_EMF_NAMESPACE = "WREN/FeedbackEngine"


@dataclass(frozen=True, slots=True)
class FootnoteMetadata:
    """A single footnote's structured metadata, as extracted on the Node side.

    Mirrors `@wren/types`'s ``ExtractedFootnote`` interface (minus
    ``paragraphIndex``, which this module does not need for prompt
    assembly).
    """

    footnote_number: int
    content: str
    author: str = ""
    title: str = ""
    source: str = ""
    pinpoint: str = ""
    year: str = ""


def _sanitize_inline(value: str) -> str:
    """Neutralize line-structure characters in attacker-controlled footnote text.

    Rendered footnote lines are newline-joined and interpolated verbatim, so a
    body or metadata value containing a newline/carriage return could forge
    extra ``[N] ...`` lines or ``(field: ...)`` segments inside the untrusted
    FOOTNOTES/CITATIONS block. Collapsing CR/LF to a single
    space keeps the value one line and length-preserving (so budget math is
    unaffected) while removing the forging primitive. The block is already
    labelled untrusted, so this is defense-in-depth against structure forgery
    rather than the sole control.
    """
    return value.replace("\r", " ").replace("\n", " ")


def _truncate_field(value: str, limit: int) -> tuple[str, int]:
    """Sanitize then trim ``value`` to ``limit`` chars with a trailing ``…``.

    Returns the (possibly truncated) value and the number of omitted chars.
    """
    value = _sanitize_inline(value)
    if len(value) <= limit:
        return value, 0
    omitted = len(value) - limit
    trimmed = f"{value[:limit]}…" if limit > 0 else ""
    return trimmed, omitted


def _cap_footnotes(
    footnotes: list[FootnoteMetadata],
) -> tuple[list[tuple[FootnoteMetadata, str]], int, int, int]:
    """Cap footnote bodies AND citation metadata for prompt rendering.

    Caps applied (findings f-ca2d70a5, f-4d906a98, f-de6a04f5):
      - at most ``MAX_FOOTNOTES_RENDERED`` footnotes are rendered; the rest are
        dropped;
      - each body is trimmed to ``MAX_FOOTNOTE_CONTENT_CHARS``;
      - each citation metadata field is trimmed to
        ``MAX_FOOTNOTE_METADATA_FIELD_CHARS``;
      - bodies AND metadata values are charged against a single running budget
        that stops at ``MAX_FOOTNOTES_TOTAL_CHARS``, so the total attacker-
        controlled text in the rendered block has an aggregate ceiling.

    Returns ``(kept, truncated_count, omitted_chars, dropped_count)`` where
    ``kept`` is a list of ``(footnote_with_capped_metadata, capped_body)`` in
    input order, ``truncated_count`` counts footnotes whose body OR any metadata
    field was trimmed, ``omitted_chars`` is the total characters cut, and
    ``dropped_count`` is the number of whole footnotes dropped by the count cap.
    """
    # Drop footnotes whose NUMBER is out of the sane range before anything else,
    # so an absurd numeric id cannot be rendered as hundreds of digits
    # (finding f-b4f8ddb1). This bounds each rendered number to <= 6 digits.
    def _valid_number(fn: FootnoteMetadata) -> bool:
        return 0 < fn.footnote_number <= MAX_FOOTNOTE_NUMBER

    def _dropped_chars(fn: FootnoteMetadata) -> int:
        return len(fn.content) + sum(
            len(getattr(fn, field))
            for field in ("author", "title", "source", "pinpoint", "year")
        )

    out_of_range = [fn for fn in footnotes if not _valid_number(fn)]
    in_range = [fn for fn in footnotes if _valid_number(fn)]

    dropped_count = len(out_of_range) + max(0, len(in_range) - MAX_FOOTNOTES_RENDERED)
    rendered = in_range[:MAX_FOOTNOTES_RENDERED]
    omitted_chars = sum(_dropped_chars(fn) for fn in out_of_range)
    omitted_chars += sum(_dropped_chars(fn) for fn in in_range[MAX_FOOTNOTES_RENDERED:])

    kept: list[tuple[FootnoteMetadata, str]] = []
    truncated_count = 0
    remaining = MAX_FOOTNOTES_TOTAL_CHARS
    for fn in rendered:
        field_omitted = 0
        body_limit = min(MAX_FOOTNOTE_CONTENT_CHARS, max(remaining, 0))
        body, body_omitted = _truncate_field(fn.content, body_limit)
        remaining -= len(body)

        capped_meta = {}
        for field in ("author", "title", "source", "pinpoint", "year"):
            # Each field is bounded by its own cap AND by the shared aggregate
            # budget (finding f-de6a04f5), so total metadata cannot blow past
            # MAX_FOOTNOTES_TOTAL_CHARS regardless of field or footnote count.
            field_limit = min(MAX_FOOTNOTE_METADATA_FIELD_CHARS, max(remaining, 0))
            capped, cut = _truncate_field(getattr(fn, field), field_limit)
            capped_meta[field] = capped
            field_omitted += cut
            remaining -= len(capped)

        if body_omitted or field_omitted:
            truncated_count += 1
            omitted_chars += body_omitted + field_omitted

        kept.append(
            (
                FootnoteMetadata(
                    footnote_number=fn.footnote_number,
                    content=body,
                    **capped_meta,
                ),
                body,
            )
        )
    return kept, truncated_count, omitted_chars, dropped_count


def _emit_footnote_cap_telemetry(
    *,
    truncated_count: int,
    omitted_chars: int,
    dropped_count: int,
    total_footnotes: int,
    workload: str,
    timestamp_ms: Optional[int],
    sink: Optional[Callable[[str], None]],
) -> None:
    """Log a warning and emit one EMF line when footnotes were capped.

    Covers body/metadata truncation and whole-footnote drops. Never raises:
    telemetry must not break prompt assembly (mirrors
    ``debrief_budget.emit_reference_cap_telemetry``).
    """
    out = sink if sink is not None else print
    try:
        logger.warning(
            "Footnotes exceeded the prompt budget (%d of %d footnotes "
            "truncated, %d dropped, %d chars omitted).",
            truncated_count,
            total_footnotes,
            dropped_count,
            omitted_chars,
        )
        event = {
            "_aws": {
                "Timestamp": timestamp_ms
                if timestamp_ms is not None
                else int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": FOOTNOTE_CAP_EMF_NAMESPACE,
                        "Dimensions": [["workload"]],
                        "Metrics": [
                            {"Name": "FootnoteCapApplied", "Unit": "Count"},
                            {"Name": "FootnotesTruncated", "Unit": "Count"},
                            {"Name": "FootnotesDropped", "Unit": "Count"},
                            {"Name": "FootnoteCharsOmitted", "Unit": "Count"},
                        ],
                    }
                ],
            },
            "workload": workload,
            "FootnoteCapApplied": 1,
            "FootnotesTruncated": truncated_count,
            "FootnotesDropped": dropped_count,
            "FootnoteCharsOmitted": omitted_chars,
        }
        out(json.dumps(event))
    except Exception:
        # Swallow — telemetry must never break the request path.
        pass


def build_footnotes_untrusted_content(
    footnotes: list[FootnoteMetadata],
    *,
    workload: str = "feedback_primary",
    timestamp_ms: Optional[int] = None,
    sink: Optional[Callable[[str], None]] = None,
) -> UntrustedContent | None:
    """Builds the FOOTNOTES/CITATIONS untrusted block (Requirement 5.2, 5.3, 5.6).

    Returns ``None`` when ``footnotes`` is empty, so callers omit the block
    entirely and the assembled prompt is byte-for-byte identical to the
    no-footnotes case today (Requirement 5.6) — the Feedback Engine's
    existing call site only appends a block to its
    ``untrusted: list[UntrustedContent]`` when this returns non-``None``.

    Each footnote becomes one line: ``[N] <content>`` followed by any
    non-empty citation fields as ``(field: value)`` suffixes, so the model
    has sufficient context to reference specific footnotes by number in its
    generated feedback (Requirement 5.3).

    Footnote bodies are capped per footnote and in aggregate
    (``MAX_FOOTNOTE_CONTENT_CHARS`` / ``MAX_FOOTNOTES_TOTAL_CHARS``) as a
    defense-in-depth bound on prompt size (finding f-ca2d70a5); when any body
    is trimmed, a warning and one EMF metric are emitted. Bodies within the
    caps are emitted byte-for-byte, so the no-oversize case is unchanged.
    """
    if not footnotes:
        return None

    kept, truncated_count, omitted_chars, dropped_count = _cap_footnotes(footnotes)
    if truncated_count or dropped_count:
        _emit_footnote_cap_telemetry(
            truncated_count=truncated_count,
            omitted_chars=omitted_chars,
            dropped_count=dropped_count,
            total_footnotes=len(footnotes),
            workload=workload,
            timestamp_ms=timestamp_ms,
            sink=sink,
        )

    lines = [
        f"[{fn.footnote_number}] {body}"
        + (f" (author: {fn.author})" if fn.author else "")
        + (f" (title: {fn.title})" if fn.title else "")
        + (f" (source: {fn.source})" if fn.source else "")
        + (f" (pinpoint: {fn.pinpoint})" if fn.pinpoint else "")
        + (f" (year: {fn.year})" if fn.year else "")
        for fn, body in kept
    ]

    return UntrustedContent(label="FOOTNOTES/CITATIONS", text="\n".join(lines))
