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

from dataclasses import dataclass

from .prompt_assembly import UntrustedContent

__all__ = ["FootnoteMetadata", "build_footnotes_untrusted_content"]


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


def build_footnotes_untrusted_content(
    footnotes: list[FootnoteMetadata],
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
    """
    if not footnotes:
        return None

    lines = [
        f"[{fn.footnote_number}] {fn.content}"
        + (f" (author: {fn.author})" if fn.author else "")
        + (f" (title: {fn.title})" if fn.title else "")
        + (f" (source: {fn.source})" if fn.source else "")
        + (f" (pinpoint: {fn.pinpoint})" if fn.pinpoint else "")
        + (f" (year: {fn.year})" if fn.year else "")
        for fn in footnotes
    ]

    return UntrustedContent(label="FOOTNOTES/CITATIONS", text="\n".join(lines))
