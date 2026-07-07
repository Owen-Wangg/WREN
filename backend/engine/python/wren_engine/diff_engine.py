"""Diff Engine for WREN Drafts (Requirement 10 / REQ-DRAFT-DIFF-01).

Computes the change set between two consecutive Drafts at paragraph +
intra-paragraph granularity, and selects the changed/added spans plus a bounded
context window for the LLM while excluding unchanged spans. Identical Drafts
yield an empty change set that short-circuits feedback generation.

Pure, deterministic, dependency-free logic built on the standard library's
``difflib`` — the ideal target for property-based testing (task 8.2). No cloud
calls, no per-Draft cost, nothing leaves ``ca-central-1``.
"""
from __future__ import annotations

from difflib import SequenceMatcher

from .models import ChangeKind, Diff, ParagraphChange, Segment, Span

__all__ = ["DiffEngine"]


class DiffEngine:
    """Compute Draft diffs and select changed+context regions for the LLM.

    Interface per design.md::

        class DiffEngine:
            def compute(self, prev, curr) -> Diff: ...
            def select_for_llm(self, diff, context_window) -> list[Span]: ...
    """

    def compute(self, prev: list[Segment], curr: list[Segment]) -> Diff:
        """Compute the paragraph + intra-paragraph :class:`Diff` (Requirement 10.1).

        A paragraph-level alignment (via :class:`difflib.SequenceMatcher` over the
        segment texts) classifies each paragraph as unchanged, changed, added, or
        deleted. For paragraphs edited in place, an intra-paragraph diff locates
        the changed character spans in current coordinates.

        Identical inputs produce a :class:`Diff` whose :attr:`~Diff.is_empty` is
        ``True`` (Requirement 10.4). The prev→curr index mapping carried on each
        :class:`ParagraphChange` is sufficient for anchor re-mapping
        (Requirement 10.5).
        """
        prev_texts = [seg.text for seg in prev]
        curr_texts = [seg.text for seg in curr]
        prev_indices = [seg.index for seg in prev]
        curr_indices = [seg.index for seg in curr]

        matcher = SequenceMatcher(a=prev_texts, b=curr_texts, autojunk=False)
        changes: list[ParagraphChange] = []

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for offset in range(i2 - i1):
                    changes.append(
                        ParagraphChange(
                            kind=ChangeKind.UNCHANGED,
                            prev_index=prev_indices[i1 + offset],
                            curr_index=curr_indices[j1 + offset],
                            prev_text=prev_texts[i1 + offset],
                            curr_text=curr_texts[j1 + offset],
                        )
                    )
            elif tag == "replace":
                changes.extend(
                    self._replace_block(
                        prev_texts, curr_texts, prev_indices, curr_indices, i1, i2, j1, j2
                    )
                )
            elif tag == "delete":
                for offset in range(i2 - i1):
                    changes.append(
                        ParagraphChange(
                            kind=ChangeKind.DELETED,
                            prev_index=prev_indices[i1 + offset],
                            prev_text=prev_texts[i1 + offset],
                        )
                    )
            elif tag == "insert":
                for offset in range(j2 - j1):
                    changes.append(
                        ParagraphChange(
                            kind=ChangeKind.ADDED,
                            curr_index=curr_indices[j1 + offset],
                            curr_text=curr_texts[j1 + offset],
                        )
                    )

        return Diff(changes=tuple(changes))

    def _replace_block(
        self,
        prev_texts: list[str],
        curr_texts: list[str],
        prev_indices: list[int],
        curr_indices: list[int],
        i1: int,
        i2: int,
        j1: int,
        j2: int,
    ) -> list[ParagraphChange]:
        """Resolve a ``replace`` opcode into changed / added / deleted paragraphs.

        Paragraphs are paired positionally within the block: the overlapping run
        is treated as in-place edits (``CHANGED`` with intra-paragraph spans),
        surplus previous paragraphs are ``DELETED``, surplus current paragraphs
        are ``ADDED``.
        """
        result: list[ParagraphChange] = []
        prev_count = i2 - i1
        curr_count = j2 - j1
        paired = min(prev_count, curr_count)

        for offset in range(paired):
            prev_text = prev_texts[i1 + offset]
            curr_text = curr_texts[j1 + offset]
            result.append(
                ParagraphChange(
                    kind=ChangeKind.CHANGED,
                    prev_index=prev_indices[i1 + offset],
                    curr_index=curr_indices[j1 + offset],
                    prev_text=prev_text,
                    curr_text=curr_text,
                    changed_spans=self._intra_paragraph_spans(
                        prev_text, curr_text, curr_indices[j1 + offset]
                    ),
                )
            )

        for offset in range(paired, prev_count):
            result.append(
                ParagraphChange(
                    kind=ChangeKind.DELETED,
                    prev_index=prev_indices[i1 + offset],
                    prev_text=prev_texts[i1 + offset],
                )
            )

        for offset in range(paired, curr_count):
            result.append(
                ParagraphChange(
                    kind=ChangeKind.ADDED,
                    curr_index=curr_indices[j1 + offset],
                    curr_text=curr_texts[j1 + offset],
                )
            )

        return result

    def _intra_paragraph_spans(
        self, prev_text: str, curr_text: str, paragraph_index: int
    ) -> tuple[Span, ...]:
        """Locate changed character spans within an edited paragraph.

        Uses a character-level :class:`difflib.SequenceMatcher`. Each non-``equal``
        opcode yields a span in *current* paragraph coordinates. A pure deletion
        (``curr`` side empty) yields a zero-width span at the deletion point so
        context can still be gathered around it.
        """
        matcher = SequenceMatcher(a=prev_text, b=curr_text, autojunk=False)
        spans: list[Span] = []
        for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            spans.append(Span(paragraph_index=paragraph_index, start=j1, end=j2))
        return tuple(spans)

    def select_for_llm(self, diff: Diff, context_window: int) -> list[Span]:
        """Select changed/added spans plus bounded context for the LLM (Requirement 10.2).

        Returns the changed and added spans, each expanded by up to
        ``context_window`` characters on either side *within its own paragraph*,
        and EXCLUDES purely unchanged spans. Overlapping/adjacent spans in the
        same paragraph are merged. The context on each side never exceeds
        ``context_window`` characters (bounding rule).

        - ``ADDED`` paragraph → the whole current paragraph is selected.
        - ``CHANGED`` paragraph → each intra-paragraph changed span, expanded by
          the bounded context and clamped to the paragraph length.
        - ``DELETED`` / ``UNCHANGED`` paragraphs contribute no spans (there is no
          current text to send, or nothing changed).

        An empty :class:`Diff` (identical Drafts, Requirement 10.4) yields ``[]``,
        so the Feedback Engine is not invoked for unchanged content.
        """
        if context_window < 0:
            raise ValueError("context_window must be non-negative")

        # Collect raw (pre-merge) spans grouped by paragraph.
        by_paragraph: dict[int, list[tuple[int, int]]] = {}

        for change in diff.changes:
            if change.kind is ChangeKind.ADDED:
                text = change.curr_text or ""
                assert change.curr_index is not None
                by_paragraph.setdefault(change.curr_index, []).append((0, len(text)))
            elif change.kind is ChangeKind.CHANGED:
                assert change.curr_index is not None
                para_len = len(change.curr_text or "")
                bucket = by_paragraph.setdefault(change.curr_index, [])
                for span in change.changed_spans:
                    start = max(0, span.start - context_window)
                    end = min(para_len, span.end + context_window)
                    bucket.append((start, end))
            # DELETED / UNCHANGED: nothing to send to the LLM.

        selected: list[Span] = []
        for paragraph_index in sorted(by_paragraph):
            for start, end in _merge_ranges(by_paragraph[paragraph_index]):
                selected.append(
                    Span(paragraph_index=paragraph_index, start=start, end=end)
                )
        return selected


def _merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge overlapping or adjacent ``[start, end)`` ranges, preserving order."""
    if not ranges:
        return []
    ordered = sorted(ranges)
    merged: list[tuple[int, int]] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:  # overlapping or adjacent
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged
