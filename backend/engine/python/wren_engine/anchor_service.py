"""Anchor Service for WREN feedback anchors (Requirement 9 / REQ-ANCHOR-01).

Re-maps each existing Feedback Item's Anchor from the previous Draft to the
corresponding span in the new Draft using the :class:`~wren_engine.models.Diff`
produced by the :class:`~wren_engine.diff_engine.DiffEngine`. A confident match
preserves the association (offsets may shift); a deleted, rewritten-beyond-
recognition, or ambiguous target marks the Anchor ``removed`` rather than
mis-attach it to unrelated text.

Design references:
  - design.md "Diff Engine, Anchor Service, Progress Tracker (Python 3.12)":
    "Anchor_Service stores, per anchor, a start/end offset, paragraph index, and
    a content fingerprint (normalized text hash + short surrounding context). On
    a new draft it re-maps each anchor using the diff: a confident match
    preserves the association (shifted offsets allowed); a deleted/unrecognizable/
    ambiguous target marks the anchor ``removed`` rather than mis-attach."
  - design.md "Anchor" entity: ``paragraphIndex``, ``startOffset``,
    ``endOffset``, ``contentFingerprint`` (normalized text hash + bounded
    surrounding context), ``state`` (``active`` | ``removed``).
  - requirements.md Requirement 9 (REQ-ANCHOR-01), criteria 9.1–9.5.

Where the Anchor types live: the ``Anchor`` / ``ContentFingerprint`` /
``RemapResult`` types live HERE, in ``anchor_service.py``, rather than in
``models.py``. ``models.py`` is deliberately the shared *diff* vocabulary
(``Segment``, ``Span``, ``ParagraphChange``, ``Diff``, ``ChangeKind``) consumed
by both the Diff Engine and the Anchor Service; the Anchor types are specific to
this service and depend on that vocabulary (they import :class:`Span`), so
co-locating them keeps ``models.py`` focused and avoids a dependency inversion.

Pure, deterministic, dependency-free (standard-library ``hashlib``/``re``) logic
— the target for property tests 8.4 / 8.5 (not implemented here).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, replace
from enum import Enum

from .models import ChangeKind, Diff, ParagraphChange, Span

__all__ = [
    "AnchorState",
    "ContentFingerprint",
    "Anchor",
    "Remapped",
    "Removed",
    "RemapResult",
    "AnchorService",
    "compute_fingerprint",
    "CONTEXT_CHARS",
]

#: Bounded surrounding-context window (characters on each side of the anchored
#: span) captured in a :class:`ContentFingerprint`. "Bounded" is the operative
#: word (design.md / Requirement 9.1): context never grows unbounded, it is used
#: to disambiguate otherwise-identical repeated text within a paragraph.
CONTEXT_CHARS = 32

_WHITESPACE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    """Normalize text for fingerprinting: casefold + collapse/strip whitespace.

    Case and whitespace differences must not, on their own, defeat identity: two
    spans that differ only in casing or internal spacing share a fingerprint.
    This is applied to the anchored text and to its surrounding context.
    """
    return _WHITESPACE.sub(" ", text).strip().casefold()


@dataclass(frozen=True, slots=True)
class ContentFingerprint:
    """Content identity for an anchored span (Requirement 9.1, 9.4).

    Stores a normalized-text hash plus a bounded, normalized surrounding-context
    window. The hash is the identity check (does the content at a candidate span
    match what the Anchor was created over?); the ``prefix``/``suffix`` context
    disambiguates repeated identical text within a paragraph so a confident
    re-map can be distinguished from an ambiguous one (Requirement 9.5).
    """

    text_hash: str
    normalized_text: str
    prefix: str
    suffix: str

    def matches(self, other: "ContentFingerprint") -> bool:
        """True when two fingerprints identify the same normalized content."""
        return self.text_hash == other.text_hash


def compute_fingerprint(
    paragraph_text: str,
    start: int,
    end: int,
    context_chars: int = CONTEXT_CHARS,
) -> ContentFingerprint:
    """Compute a :class:`ContentFingerprint` for ``paragraph_text[start:end]``.

    This is the SINGLE fingerprint function used both when an Anchor is created
    and when it is re-mapped, so anchoring and re-mapping stay consistent
    (Requirement 9.1). ``context_chars`` bounds the surrounding-context window on
    each side.
    """
    if start < 0 or end < 0:
        raise ValueError("anchor offsets must be non-negative")
    if end < start:
        raise ValueError("anchor end must be >= start")
    if context_chars < 0:
        raise ValueError("context_chars must be non-negative")

    anchored = paragraph_text[start:end]
    normalized = _normalize(anchored)
    prefix = _normalize(paragraph_text[max(0, start - context_chars):start])
    suffix = _normalize(paragraph_text[end:end + context_chars])
    text_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return ContentFingerprint(
        text_hash=text_hash,
        normalized_text=normalized,
        prefix=prefix,
        suffix=suffix,
    )


class AnchorState(str, Enum):
    """Lifecycle state of an Anchor (design.md "Anchor" entity).

    - ``ACTIVE``: the Anchor is bound to a live span in the current Draft.
    - ``REMOVED``: the anchored text was deleted, rewritten beyond recognition,
      or could not be confidently re-mapped (Requirement 9.2, 9.4, 9.5).
    """

    ACTIVE = "active"
    REMOVED = "removed"


@dataclass(frozen=True, slots=True)
class Anchor:
    """A feedback Anchor: where a Feedback Item attaches within a Draft.

    Mirrors the design "Anchor" entity's positional + content-fingerprint fields
    (Requirement 9.1). ``feedback_item_id`` is the minimal linkage back to the
    Feedback Item the Anchor belongs to; the pure engine does not otherwise
    interpret it.
    """

    paragraph_index: int
    start_offset: int
    end_offset: int
    content_fingerprint: ContentFingerprint
    feedback_item_id: str | None = None
    state: AnchorState = AnchorState.ACTIVE

    def __post_init__(self) -> None:
        if self.start_offset < 0 or self.end_offset < 0:
            raise ValueError("anchor offsets must be non-negative")
        if self.end_offset < self.start_offset:
            raise ValueError("anchor end_offset must be >= start_offset")

    @classmethod
    def create(
        cls,
        paragraph_text: str,
        paragraph_index: int,
        start_offset: int,
        end_offset: int,
        feedback_item_id: str | None = None,
        context_chars: int = CONTEXT_CHARS,
    ) -> "Anchor":
        """Create an active Anchor, computing its fingerprint from ``paragraph_text``.

        Uses :func:`compute_fingerprint` so the stored fingerprint is identical
        to what re-mapping recomputes for the same text+span (Requirement 9.1).
        """
        fingerprint = compute_fingerprint(
            paragraph_text, start_offset, end_offset, context_chars=context_chars
        )
        return cls(
            paragraph_index=paragraph_index,
            start_offset=start_offset,
            end_offset=end_offset,
            content_fingerprint=fingerprint,
            feedback_item_id=feedback_item_id,
            state=AnchorState.ACTIVE,
        )


@dataclass(frozen=True, slots=True)
class Remapped:
    """A confidently re-mapped Anchor and its current-Draft span (Requirement 9.3).

    ``anchor`` is the updated Anchor (``anchor'``): its ``paragraph_index`` and
    offsets point into the current Draft and its fingerprint is recomputed from
    the current text so the NEXT re-map is consistent. ``span`` is the same
    location expressed as a :class:`~wren_engine.models.Span` in current coords.
    """

    anchor: Anchor
    span: Span


@dataclass(frozen=True, slots=True)
class Removed:
    """An Anchor that could not be confidently re-mapped (Requirement 9.2, 9.4, 9.5).

    ``anchor`` is the input Anchor with :attr:`AnchorState.REMOVED`. It carries no
    current-Draft span: the Feedback Presenter surfaces it in a "no longer
    applies / removed" state rather than attaching it to unrelated text.
    """

    anchor: Anchor


#: The result of re-mapping one Anchor across a Draft (design.md interface:
#: ``RemapResult = Remapped(anchor', span) | Removed(anchor)``).
RemapResult = Remapped | Removed


class AnchorService:
    """Re-map Anchors across Drafts using a computed :class:`Diff` (REQ-ANCHOR-01).

    Interface per design.md::

        class AnchorService:
            def remap(self, anchors: list[Anchor], diff: Diff) -> list[RemapResult]: ...
            # RemapResult = Remapped(anchor', span) | Removed(anchor)

    Confidence heuristic (how a confident match is told apart from an
    ambiguous / rewritten-beyond-recognition one):

    * UNCHANGED paragraph — the text is identical, so offsets are preserved and
      only the paragraph index shifts to its new position. The stored fingerprint
      is re-confirmed against the current text; a mismatch (which should not
      happen for identical text) is treated defensively as ``removed``
      (Requirement 9.3, defensively 9.5).
    * CHANGED paragraph — the original anchored substring (recovered from the
      diff's ``prev_text``) is searched for verbatim in the new paragraph text:
        - exactly one occurrence → confident match, offsets shift to the new
          position (Requirement 9.3);
        - several occurrences → the bounded surrounding-context fingerprint is
          used to disambiguate; a single context match wins, otherwise the match
          is ambiguous → ``removed`` (Requirement 9.5);
        - zero occurrences → the span was rewritten beyond recognition →
          ``removed`` (Requirement 9.2, 9.5).
    * DELETED paragraph → ``removed`` (Requirement 9.4).
    * A paragraph with no prev-side entry in the diff → ``removed`` (defensive;
      never guess, Requirement 9.2).
    """

    def remap(self, anchors: list[Anchor], diff: Diff) -> list[RemapResult]:
        """Re-map each Anchor from the previous Draft to the new Draft (Requirement 9.1)."""
        prev_index_to_change: dict[int, ParagraphChange] = {
            change.prev_index: change
            for change in diff.changes
            if change.prev_index is not None
        }

        results: list[RemapResult] = []
        for anchor in anchors:
            results.append(self._remap_one(anchor, prev_index_to_change))
        return results

    def _remap_one(
        self, anchor: Anchor, prev_index_to_change: dict[int, ParagraphChange]
    ) -> RemapResult:
        change = prev_index_to_change.get(anchor.paragraph_index)

        # The anchored paragraph is absent from the previous side of the diff:
        # we cannot confidently place it, so never guess (Requirement 9.2).
        if change is None:
            return self._removed(anchor)

        if change.kind is ChangeKind.DELETED:
            # The whole paragraph was deleted (Requirement 9.4).
            return self._removed(anchor)

        if change.kind is ChangeKind.UNCHANGED:
            return self._remap_unchanged(anchor, change)

        if change.kind is ChangeKind.CHANGED:
            return self._remap_changed(anchor, change)

        # ADDED changes have no prev_index and never reach this map.
        return self._removed(anchor)

    def _remap_unchanged(
        self, anchor: Anchor, change: ParagraphChange
    ) -> RemapResult:
        """Preserve offsets, shift only the paragraph index (Requirement 9.3)."""
        curr_text = change.curr_text or ""
        assert change.curr_index is not None

        # Defensive bounds check: identical text should preserve offsets exactly.
        if anchor.end_offset > len(curr_text):
            return self._removed(anchor)

        recomputed = compute_fingerprint(
            curr_text, anchor.start_offset, anchor.end_offset
        )
        # For truly-unchanged text this always matches; a mismatch means the
        # stored fingerprint does not correspond to this paragraph, so we refuse
        # to attach rather than risk mis-attachment (Requirement 9.5).
        if not recomputed.matches(anchor.content_fingerprint):
            return self._removed(anchor)

        return self._remapped(
            anchor,
            paragraph_index=change.curr_index,
            start=anchor.start_offset,
            end=anchor.end_offset,
            fingerprint=recomputed,
        )

    def _remap_changed(
        self, anchor: Anchor, change: ParagraphChange
    ) -> RemapResult:
        """Re-locate a surviving span within an edited paragraph (Requirement 9.3, 9.5)."""
        prev_text = change.prev_text or ""
        curr_text = change.curr_text or ""
        assert change.curr_index is not None

        # Recover the exact original anchored text from the diff's prev side.
        if anchor.end_offset > len(prev_text):
            return self._removed(anchor)
        original = prev_text[anchor.start_offset:anchor.end_offset]

        # A zero-width / whitespace-only anchor has no content to relocate on.
        if not original.strip():
            return self._removed(anchor)

        # Sanity: the anchor's stored fingerprint should identify this original
        # text. If it does not, the anchor is inconsistent with the diff's prev
        # Draft — refuse rather than guess (Requirement 9.2).
        original_fp = compute_fingerprint(
            prev_text, anchor.start_offset, anchor.end_offset
        )
        if not original_fp.matches(anchor.content_fingerprint):
            return self._removed(anchor)

        occurrences = _find_all(curr_text, original)

        if not occurrences:
            # Rewritten beyond recognition / deleted in place (Requirement 9.2, 9.5).
            return self._removed(anchor)

        if len(occurrences) == 1:
            start = occurrences[0]
            return self._confident_remap(anchor, change.curr_index, curr_text, start, len(original))

        # Multiple identical occurrences: disambiguate via bounded context.
        context_matches = [
            start
            for start in occurrences
            if self._context_matches(anchor, curr_text, start, len(original))
        ]
        if len(context_matches) == 1:
            start = context_matches[0]
            return self._confident_remap(anchor, change.curr_index, curr_text, start, len(original))

        # Still ambiguous (zero or several context matches) → never mis-attach
        # (Requirement 9.5).
        return self._removed(anchor)

    def _confident_remap(
        self,
        anchor: Anchor,
        paragraph_index: int,
        curr_text: str,
        start: int,
        length: int,
    ) -> Remapped:
        """Build a :class:`Remapped` for a confidently located span."""
        end = start + length
        fingerprint = compute_fingerprint(curr_text, start, end)
        return self._remapped(
            anchor,
            paragraph_index=paragraph_index,
            start=start,
            end=end,
            fingerprint=fingerprint,
        )

    def _context_matches(
        self, anchor: Anchor, curr_text: str, start: int, length: int
    ) -> bool:
        """True when the bounded surrounding context at a candidate matches the Anchor."""
        candidate = compute_fingerprint(curr_text, start, start + length)
        fp = anchor.content_fingerprint
        return candidate.prefix == fp.prefix and candidate.suffix == fp.suffix

    @staticmethod
    def _remapped(
        anchor: Anchor,
        *,
        paragraph_index: int,
        start: int,
        end: int,
        fingerprint: ContentFingerprint,
    ) -> Remapped:
        updated = replace(
            anchor,
            paragraph_index=paragraph_index,
            start_offset=start,
            end_offset=end,
            content_fingerprint=fingerprint,
            state=AnchorState.ACTIVE,
        )
        span = Span(paragraph_index=paragraph_index, start=start, end=end)
        return Remapped(anchor=updated, span=span)

    @staticmethod
    def _removed(anchor: Anchor) -> Removed:
        return Removed(anchor=replace(anchor, state=AnchorState.REMOVED))


def _find_all(haystack: str, needle: str) -> list[int]:
    """Return every start index where ``needle`` occurs in ``haystack``.

    Overlapping occurrences are included (the scan advances by one) so that
    repeated identical text is fully counted for ambiguity detection.
    """
    if not needle:
        return []
    positions: list[int] = []
    idx = haystack.find(needle)
    while idx != -1:
        positions.append(idx)
        idx = haystack.find(needle, idx + 1)
    return positions
