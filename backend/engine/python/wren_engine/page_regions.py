"""Repeating page header/footer text for the WREN Feedback Engine.

The editor stores the page header and footer in their own ``draft.header`` /
``draft.footer`` TipTap JSON columns, separate from the body ``content`` that
``segments`` are derived from. Without this block the model never sees them,
so a running head, page numbers, or a course/author line placed in the header
or footer reads as missing and gets flagged as an issue.

Mirrors ``footnote_metadata.py``: pure, deterministic, dependency-free, and
returns ``None`` when there is nothing to render so callers omit the block and
the assembled prompt is byte-for-byte unchanged.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .prompt_assembly import UntrustedContent

__all__ = [
    "PageRegions",
    "MAX_PAGE_REGION_CHARS",
    "PAGE_REGIONS_LABEL",
    "PAGE_REGIONS_DIRECTIVE",
    "page_region_text",
    "page_regions_from_columns",
    "build_page_regions_untrusted_content",
]

# Defense-in-depth cap per region. The Node write gate already counts header
# and footer text against the draft size limit, but the engine must not assume
# the gate was applied (a stored draft could predate it). A real header or
# footer is a line or two; this bound keeps one from inflating the prompt.
MAX_PAGE_REGION_CHARS = 2_000

PAGE_REGIONS_LABEL = "PAGE HEADER/FOOTER"

# Trusted directive appended to the per-submission dynamic directives only when
# a header or footer is present (never to the cached document-type block).
PAGE_REGIONS_DIRECTIVE = (
    "PAGE HEADER/FOOTER: The submitted document has a repeating page header "
    "and/or footer, provided in the PAGE HEADER/FOOTER data block. That text "
    "appears at the top/bottom of EVERY page of the document. Treat it as "
    "present when evaluating formatting or required elements (e.g. running "
    "head, page numbers, author, course, or date lines) — do NOT flag those "
    "elements as missing when they appear there. [page number] and [date] are "
    "placeholders the editor fills in on every page at export. Header/footer "
    "text is not part of any paragraph, so never use it as an anchor.quotedText; "
    "if it needs feedback, use a kind=\"structural\" item."
)

# Separator for paragraph / hard-break boundaries inside one region, so a
# multi-line header stays a single rendered line (no line-structure forging).
_LINE_SEPARATOR = " / "

_PLACEHOLDERS = {
    "pageNumber": "[page number]",
    "date": "[date]",
}

_BLOCK_TYPES = {"paragraph", "heading", "listItem", "blockquote"}


@dataclass(frozen=True, slots=True)
class PageRegions:
    """Plain-text header and footer of a draft ("" when absent)."""

    header: str = ""
    footer: str = ""

    def is_empty(self) -> bool:
        return not self.header and not self.footer

    def combined_text(self) -> str:
        """Header and footer joined for hashing / judge context."""
        return "\n".join(part for part in (self.header, self.footer) if part)


def _flatten(node: Any, lines: list[str], current: list[str]) -> None:
    if not isinstance(node, dict):
        return
    node_type = node.get("type")
    if node_type in _PLACEHOLDERS:
        current.append(_PLACEHOLDERS[node_type])
        return
    if node_type == "hardBreak":
        lines.append("".join(current))
        current.clear()
        return
    text = node.get("text")
    if isinstance(text, str):
        current.append(text)
        return
    children = node.get("content")
    if not isinstance(children, list):
        return
    for child in children:
        _flatten(child, lines, current)
    if node_type in _BLOCK_TYPES:
        lines.append("".join(current))
        current.clear()


def page_region_text(doc: Any) -> str:
    """Flatten a header/footer TipTap doc to one sanitized line of text.

    Accepts the raw column value (dict, JSON string, or ``None``). Page-number
    and date chips become ``[page number]`` / ``[date]`` placeholders; block and
    hard-break boundaries become `` / ``. Returns ``""`` for empty or malformed
    input.
    """
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except (json.JSONDecodeError, ValueError):
            return ""
    lines: list[str] = []
    current: list[str] = []
    _flatten(doc, lines, current)
    if current:
        lines.append("".join(current))
    cleaned = (
        " ".join(line.replace("\r", " ").replace("\n", " ").split())
        for line in lines
    )
    return _LINE_SEPARATOR.join(line for line in cleaned if line)


def page_regions_from_columns(header: Any, footer: Any) -> PageRegions:
    """Build :class:`PageRegions` from raw ``draft.header`` / ``draft.footer``."""
    return PageRegions(header=page_region_text(header), footer=page_region_text(footer))


def _cap(value: str) -> str:
    if len(value) <= MAX_PAGE_REGION_CHARS:
        return value
    return f"{value[:MAX_PAGE_REGION_CHARS]}…"


def build_page_regions_untrusted_content(
    regions: PageRegions | None,
) -> UntrustedContent | None:
    """Builds the PAGE HEADER/FOOTER untrusted block.

    Returns ``None`` when neither region has text, so callers omit the block.
    """
    if regions is None or regions.is_empty():
        return None
    lines = []
    if regions.header:
        lines.append(f"HEADER (top of every page): {_cap(regions.header)}")
    if regions.footer:
        lines.append(f"FOOTER (bottom of every page): {_cap(regions.footer)}")
    return UntrustedContent(label=PAGE_REGIONS_LABEL, text="\n".join(lines))
