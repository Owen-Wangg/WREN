"""Shared domain types for the WREN Diff / Anchor / Progress engine (Python 3.12).

These dataclasses are the pure-logic vocabulary shared across the engine package.
The :class:`Diff` produced by :class:`~wren_engine.diff_engine.DiffEngine` is
consumed both by the LLM-selection step (Requirement 10.2) and, later, by the
Anchor Service to decide which spans survived, shifted, or were removed across
Drafts (Requirement 10.5 / REQ-ANCHOR-01).

Design references:
  - design.md "Diff Engine, Anchor Service, Progress Tracker (Python 3.12)"
  - requirements.md Requirement 10 (REQ-DRAFT-DIFF-01)

Type alignment: :class:`Segment` mirrors the TypeScript ``@wren/types`` Segment
(``{ index, text }``) so the Node Document Service and this Python engine agree
on the paragraph-segment substrate for anchoring and diffing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

__all__ = [
    "Segment",
    "ChangeKind",
    "Span",
    "ParagraphChange",
    "Diff",
]


@dataclass(frozen=True, slots=True)
class Segment:
    """An ordered paragraph segment: a stable index plus its paragraph text.

    Mirrors ``@wren/types`` ``Segment`` (``{ index, text }``). ``index`` is the
    stable, zero-based position of the paragraph within its Draft; it is the
    substrate for both anchoring and diffing (design.md "Segmentation").
    """

    index: int
    text: str


class ChangeKind(str, Enum):
    """How a paragraph relates between the previous and current Draft.

    - ``UNCHANGED``: paragraph text is identical (it may have shifted position).
    - ``CHANGED``: paragraph exists in both Drafts but its text differs.
    - ``ADDED``: paragraph exists only in the current Draft.
    - ``DELETED``: paragraph existed only in the previous Draft.
    """

    UNCHANGED = "unchanged"
    CHANGED = "changed"
    ADDED = "added"
    DELETED = "deleted"


@dataclass(frozen=True, slots=True)
class Span:
    """A half-open ``[start, end)`` character range within one paragraph.

    ``paragraph_index`` refers to a paragraph index in the *current* Draft
    (added/changed spans always have current-Draft text to send to the LLM).
    A zero-width span (``start == end``) marks a change *location* (e.g. a pure
    deletion inside an otherwise-surviving paragraph) so context can be gathered
    around it.
    """

    paragraph_index: int
    start: int
    end: int

    def __post_init__(self) -> None:
        if self.start < 0 or self.end < 0:
            raise ValueError("span offsets must be non-negative")
        if self.end < self.start:
            raise ValueError("span end must be >= start")


@dataclass(frozen=True, slots=True)
class ParagraphChange:
    """A single paragraph-level entry in a :class:`Diff`.

    Captures enough for two consumers:
      1. LLM selection (Requirement 10.2) — the current text and any
         intra-paragraph ``changed_spans`` for ``CHANGED`` paragraphs.
      2. Anchor re-mapping (Requirement 10.5) — the prev→curr index mapping that
         tells the Anchor Service whether a span survived (possibly shifted),
         was added, or was removed.

    Index/text fields are ``None`` on the side where the paragraph does not exist
    (``prev_*`` is ``None`` for ``ADDED``; ``curr_*`` is ``None`` for ``DELETED``).
    ``changed_spans`` is populated only for ``CHANGED`` paragraphs and is
    expressed in *current* paragraph coordinates.
    """

    kind: ChangeKind
    prev_index: int | None = None
    curr_index: int | None = None
    prev_text: str | None = None
    curr_text: str | None = None
    changed_spans: tuple[Span, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class Diff:
    """The ordered change set between two consecutive Drafts.

    ``changes`` preserves reading order. An *empty change set* (Requirement 10.4)
    means every paragraph is ``UNCHANGED`` — identical Drafts short-circuit
    feedback generation. Use :attr:`is_empty` to test this.
    """

    changes: tuple[ParagraphChange, ...] = field(default_factory=tuple)

    @property
    def is_empty(self) -> bool:
        """True when no paragraph was added, deleted, or changed (Requirement 10.4)."""
        return all(c.kind is ChangeKind.UNCHANGED for c in self.changes)

    @property
    def added(self) -> tuple[ParagraphChange, ...]:
        """Paragraphs present only in the current Draft."""
        return tuple(c for c in self.changes if c.kind is ChangeKind.ADDED)

    @property
    def deleted(self) -> tuple[ParagraphChange, ...]:
        """Paragraphs present only in the previous Draft."""
        return tuple(c for c in self.changes if c.kind is ChangeKind.DELETED)

    @property
    def changed(self) -> tuple[ParagraphChange, ...]:
        """Paragraphs edited in place (present in both, different text)."""
        return tuple(c for c in self.changes if c.kind is ChangeKind.CHANGED)

    @property
    def unchanged(self) -> tuple[ParagraphChange, ...]:
        """Paragraphs whose text is identical across both Drafts."""
        return tuple(c for c in self.changes if c.kind is ChangeKind.UNCHANGED)
