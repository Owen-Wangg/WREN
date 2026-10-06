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
    "FOOTNOTE_CAP_EMF_NAMESPACE",
    "build_footnotes_untrusted_content",
]

logger = logging.getLogger(__name__)

# Defense-in-depth caps on footnote body text appended to the Bedrock prompt
# (finding f-ca2d70a5). The Node write gate now counts footnote bodies, but the
# engine must not assume the gate was applied: a stored draft could predate the
# fix. We bound each footnote body and the aggregate so a draft that slipped
# past the gate cannot inflate the prompt without bound. The per-file reference
# caps in ``debrief_budget`` (4k/12k chars) are the model for these values.
MAX_FOOTNOTE_CONTENT_CHARS = 2_000
MAX_FOOTNOTES_TOTAL_CHARS = 12_000

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


def _cap_footnote_bodies(
    footnotes: list[FootnoteMetadata],
) -> tuple[list[str], int, int]:
    """Return each footnote's (possibly truncated) body plus truncation counts.

    Each body is trimmed to ``MAX_FOOTNOTE_CONTENT_CHARS`` and the running
    total of kept body characters stops at ``MAX_FOOTNOTES_TOTAL_CHARS``;
    once the aggregate budget is exhausted, remaining bodies are emptied. A
    trailing ``…`` marks any body that lost characters. Returns the capped
    body strings in input order, the number of bodies truncated, and the
    number of body characters omitted.
    """
    bodies: list[str] = []
    truncated_count = 0
    omitted_chars = 0
    remaining = MAX_FOOTNOTES_TOTAL_CHARS
    for fn in footnotes:
        content = fn.content
        limit = min(MAX_FOOTNOTE_CONTENT_CHARS, max(remaining, 0))
        if len(content) > limit:
            omitted_chars += len(content) - limit
            truncated_count += 1
            content = f"{content[:limit]}…" if limit > 0 else ""
        bodies.append(content)
        remaining -= len(content)
    return bodies, truncated_count, omitted_chars


def _emit_footnote_cap_telemetry(
    *,
    truncated_count: int,
    omitted_chars: int,
    total_footnotes: int,
    workload: str,
    timestamp_ms: Optional[int],
    sink: Optional[Callable[[str], None]],
) -> None:
    """Log a warning and emit one EMF line when footnote bodies were capped.

    Never raises: telemetry must not break prompt assembly (mirrors
    ``debrief_budget.emit_reference_cap_telemetry``).
    """
    out = sink if sink is not None else print
    try:
        logger.warning(
            "Footnote bodies exceeded the prompt budget (%d of %d footnotes "
            "truncated, %d chars omitted).",
            truncated_count,
            total_footnotes,
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
                            {"Name": "FootnoteCharsOmitted", "Unit": "Count"},
                        ],
                    }
                ],
            },
            "workload": workload,
            "FootnoteCapApplied": 1,
            "FootnotesTruncated": truncated_count,
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

    bodies, truncated_count, omitted_chars = _cap_footnote_bodies(footnotes)
    if truncated_count:
        _emit_footnote_cap_telemetry(
            truncated_count=truncated_count,
            omitted_chars=omitted_chars,
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
        for fn, body in zip(footnotes, bodies)
    ]

    return UntrustedContent(label="FOOTNOTES/CITATIONS", text="\n".join(lines))
