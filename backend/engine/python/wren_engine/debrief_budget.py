"""Budgets that keep a debrief Bedrock call from running for minutes.

Long drafts were slow because the engine dumped every reference file into the
prompt and asked Claude for up to 16k output tokens. These helpers cap both.

Reference grounding is deliberately full-text, not RAG: every reference file
for the Document Type goes into the prompt, in S3 key order, until the caps
below are reached. When the caps cut anything, :func:`emit_reference_cap_telemetry`
logs a warning and emits a CloudWatch EMF metric so the cut is observable.
Admins control what survives the cap through file naming (for example ``01_``,
``02_`` prefixes sort first).
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

__all__ = [
    "MAX_REFERENCE_TOTAL_CHARS",
    "MAX_REFERENCE_PER_FILE_CHARS",
    "MIN_DEBRIEF_MAX_TOKENS",
    "MAX_DEBRIEF_MAX_TOKENS",
    "REFERENCE_CAP_EMF_NAMESPACE",
    "ReferenceCapReport",
    "build_reference_cap_emf_event",
    "cap_reference_materials",
    "cap_reference_materials_with_report",
    "debrief_max_tokens",
    "emit_reference_cap_telemetry",
]

logger = logging.getLogger(__name__)

MAX_REFERENCE_TOTAL_CHARS = 12_000
MAX_REFERENCE_PER_FILE_CHARS = 4_000
MIN_DEBRIEF_MAX_TOKENS = 2560
MAX_DEBRIEF_MAX_TOKENS = 6144

# EMF namespace for Feedback Engine prompt-assembly metrics. Only ``workload``
# is a dimension: no user, document, draft, department, or job identifiers.
REFERENCE_CAP_EMF_NAMESPACE = "WREN/FeedbackEngine"


@dataclass(frozen=True)
class ReferenceCapReport:
    """What :func:`cap_reference_materials_with_report` kept and cut.

    ``truncated`` / ``dropped`` hold each affected material's S3 key (or title
    when no key is present) in input order.
    """

    materials: list[dict[str, Any]]
    total_files: int
    truncated: tuple[str, ...]
    dropped: tuple[str, ...]
    original_chars: int
    kept_chars: int

    @property
    def was_capped(self) -> bool:
        return bool(self.truncated or self.dropped)

    @property
    def omitted_chars(self) -> int:
        return max(0, self.original_chars - self.kept_chars)


def _material_label(material: dict[str, Any]) -> str:
    return str(material.get("key") or material.get("title") or "")


def cap_reference_materials_with_report(
    materials: list[dict[str, Any]],
) -> ReferenceCapReport:
    """Cap reference materials and report exactly what was cut.

    Materials are taken in the order given (the caller sorts by S3 key). Each
    file is trimmed to ``MAX_REFERENCE_PER_FILE_CHARS`` and the running total
    stops at ``MAX_REFERENCE_TOTAL_CHARS``; files after that point are dropped.
    """
    capped: list[dict[str, Any]] = []
    truncated: list[str] = []
    dropped: list[str] = []
    original_chars = 0
    kept_chars = 0
    remaining = MAX_REFERENCE_TOTAL_CHARS
    for material in materials:
        content = str(material.get("content") or "")
        original_chars += len(content)
        if remaining <= 0:
            dropped.append(_material_label(material))
            continue
        limit = min(MAX_REFERENCE_PER_FILE_CHARS, remaining)
        if len(content) > limit:
            trimmed = content[:limit].rsplit(" ", 1)[0]
            content = f"{trimmed}…" if trimmed else content[:limit]
            content = content[:limit]
            truncated.append(_material_label(material))
        capped.append({**material, "content": content})
        kept_chars += len(content)
        remaining -= len(content)
    return ReferenceCapReport(
        materials=capped,
        total_files=len(materials),
        truncated=tuple(truncated),
        dropped=tuple(dropped),
        original_chars=original_chars,
        kept_chars=kept_chars,
    )


def cap_reference_materials(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep reference dumps small enough that prefill does not dominate latency."""
    return cap_reference_materials_with_report(materials).materials


def build_reference_cap_emf_event(
    report: ReferenceCapReport,
    *,
    workload: str = "feedback_primary",
    timestamp_ms: Optional[int] = None,
) -> dict[str, Any]:
    """Build the EMF event for a capped reference set. Dimension: ``workload`` only."""
    return {
        "_aws": {
            "Timestamp": timestamp_ms
            if timestamp_ms is not None
            else int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": REFERENCE_CAP_EMF_NAMESPACE,
                    "Dimensions": [["workload"]],
                    "Metrics": [
                        {"Name": "ReferenceCapApplied", "Unit": "Count"},
                        {"Name": "ReferenceFilesTruncated", "Unit": "Count"},
                        {"Name": "ReferenceFilesDropped", "Unit": "Count"},
                        {"Name": "ReferenceCharsOmitted", "Unit": "Count"},
                    ],
                }
            ],
        },
        "workload": workload,
        "ReferenceCapApplied": 1,
        "ReferenceFilesTruncated": len(report.truncated),
        "ReferenceFilesDropped": len(report.dropped),
        "ReferenceCharsOmitted": report.omitted_chars,
    }


def emit_reference_cap_telemetry(
    report: ReferenceCapReport,
    *,
    workload: str = "feedback_primary",
    timestamp_ms: Optional[int] = None,
    sink: Optional[Callable[[str], None]] = None,
) -> None:
    """Log a warning and emit one EMF line when the reference cap cut anything.

    Does nothing when every file fit. Never raises: telemetry must not break
    prompt assembly.
    """
    if not report.was_capped:
        return
    out = sink if sink is not None else print
    try:
        logger.warning(
            "Reference material exceeded the prompt budget (%d/%d chars kept, "
            "%d of %d files truncated, %d dropped). Truncated: %s. Dropped: %s.",
            report.kept_chars,
            report.original_chars,
            len(report.truncated),
            report.total_files,
            len(report.dropped),
            ", ".join(report.truncated) or "none",
            ", ".join(report.dropped) or "none",
        )
        out(
            json.dumps(
                build_reference_cap_emf_event(
                    report, workload=workload, timestamp_ms=timestamp_ms
                )
            )
        )
    except Exception:
        # Swallow — telemetry must never break the request path.
        pass


def debrief_max_tokens(*, inline_cap: int, category_count: int) -> int:
    """Size the Bedrock output budget from the item cap, not a 16k ceiling."""
    estimated_items = max(1, inline_cap) + max(category_count, 1) + 2
    return min(
        MAX_DEBRIEF_MAX_TOKENS,
        max(MIN_DEBRIEF_MAX_TOKENS, estimated_items * 150 + 200),
    )
