"""Progress Tracker for WREN Feedback Items (Requirement 17 / REQ-RESOLUTION-01,
Requirement 18 / REQ-PROGRESS-ACK-01).

Re-evaluates each existing Feedback Item to exactly one :class:`ResolutionStatus`
against a new Draft, and recognizes recurring patterns across the resolution
history. Both operations are pure, deterministic, dependency-free logic — the
prime target for property-based testing (tasks 8.7 / 8.9, implemented
separately).

Design references:
  - design.md "Diff Engine, Anchor Service, Progress Tracker (Python 3.12)":
    "Progress_Tracker re-evaluates each Feedback Item to a Resolution Status
    (`resolved`, `partially_resolved`, `still_unresolved`, `removed`,
    `unchanged`), tracked per Feedback Item (not per span). Unchanged spans →
    `unchanged` without an LLM call; `removed` anchors → `removed`; changed spans
    use the diff-selected region as model input. Resolution history is persisted
    across drafts. Pattern recognition runs across >=2 drafts and surfaces
    improving/persistent/emerging tendencies; with <2 drafts no pattern claims
    are made."
  - design.md interface::

        class ProgressTracker:
            def reevaluate(self, items, diff, judge) -> list[ResolutionUpdate]: ...
            def detect_patterns(self, history) -> list[PatternAck]: ...

  - design.md "ResolutionStatusHistory" entity: append-only per (item, draft).
  - requirements.md Requirement 17 (REQ-RESOLUTION-01) criteria 17.1-17.6 and
    Requirement 18 (REQ-PROGRESS-ACK-01) criteria 18.2, 18.5.

Where the Progress-Tracker types live: the ``ResolutionStatus`` / ``FeedbackItem``
/ ``ResolutionUpdate`` / ``ResolutionHistory`` / ``PatternAck`` types live HERE,
in ``progress_tracker.py``, rather than in ``models.py`` — mirroring the Anchor
Service. ``models.py`` is deliberately the shared *diff* vocabulary
(``Segment``, ``Span``, ``ParagraphChange``, ``Diff``, ``ChangeKind``); the
resolution types are specific to this service and depend on the Anchor Service's
:class:`~wren_engine.anchor_service.RemapResult`, so co-locating them keeps
``models.py`` focused and avoids a dependency inversion.

The **SpanJudge** is an injected abstraction (a callable / :class:`typing.Protocol`)
so the pure logic stays deterministic and property-testable without invoking a
real model. It is called ONLY for changed governing spans (Requirement 17.5);
``removed`` anchors and unchanged spans never reach it (Requirement 17.3, 17.4).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol, runtime_checkable

from .anchor_service import Remapped, RemapResult, Removed
from .diff_engine import DiffEngine
from .models import ChangeKind, Diff, Span

__all__ = [
    "ResolutionStatus",
    "PatternTendency",
    "FeedbackItem",
    "JudgeInput",
    "SpanJudge",
    "ResolutionUpdate",
    "ResolutionEntry",
    "ResolutionHistory",
    "PatternAck",
    "ProgressTracker",
    "DEFAULT_CONTEXT_WINDOW",
]

#: Default bounded context window (characters on each side of a changed span)
#: used to build the diff-selected region handed to the judge (Requirement 17.5,
#: REQ-DRAFT-DIFF-01). Callers may override per call.
DEFAULT_CONTEXT_WINDOW = 40


class ResolutionStatus(str, Enum):
    """The single Resolution Status assigned to a Feedback Item (Requirement 17.1).

    - ``RESOLVED``: the underlying issue was addressed in the new Draft.
    - ``PARTIALLY_RESOLVED``: the issue was partially addressed.
    - ``STILL_UNRESOLVED``: the issue remains after the edit.
    - ``REMOVED``: the anchored text was deleted / rewritten beyond recognition /
      could not be confidently re-mapped (Requirement 17.3; from REQ-ANCHOR-01).
    - ``UNCHANGED``: the span governing the item did not change, so the prior
      assessment carries forward with NO model judgment (Requirement 17.4).
    """

    RESOLVED = "resolved"
    PARTIALLY_RESOLVED = "partially_resolved"
    STILL_UNRESOLVED = "still_unresolved"
    REMOVED = "removed"
    UNCHANGED = "unchanged"


#: Statuses a :class:`SpanJudge` is allowed to return. ``removed`` and
#: ``unchanged`` are decided structurally by the Progress Tracker (from the
#: anchor re-map and the diff) and are never a model verdict.
_JUDGMENT_STATUSES: frozenset[ResolutionStatus] = frozenset(
    {
        ResolutionStatus.RESOLVED,
        ResolutionStatus.PARTIALLY_RESOLVED,
        ResolutionStatus.STILL_UNRESOLVED,
    }
)


class PatternTendency(str, Enum):
    """A qualitative, non-numeric tendency for a recurring category (Requirement 18.2).

    - ``IMPROVING``: open items in this category decreased across Drafts.
    - ``PERSISTENT``: open items in this category persist across Drafts.
    - ``NEARLY_RESOLVED``: only 1 open item remains and the count has not increased.
    - ``EMERGING``: this category newly appears (with open items) in the latest
      Draft only.
    """

    IMPROVING = "improving"
    PERSISTENT = "persistent"
    NEARLY_RESOLVED = "nearly_resolved"
    EMERGING = "emerging"


@dataclass(frozen=True, slots=True)
class FeedbackItem:
    """A Feedback Item being re-evaluated against a new Draft.

    This is the pure-logic projection the Progress Tracker needs — it is NOT the
    full persisted entity. ``remap`` is the Anchor Service's outcome for this
    item's Anchor (:class:`~wren_engine.anchor_service.Remapped` /
    :class:`~wren_engine.anchor_service.Removed`), which the Anchor Service
    produced from the same :class:`Diff`. ``category_id`` links the item to its
    (configurable) error category and is the grouping key for pattern detection
    across Drafts (Requirement 18.2).

    Resolution is tracked per Feedback Item, not per span (Requirement 17.2):
    each item yields exactly one :class:`ResolutionUpdate`.
    """

    item_id: str
    category_id: str
    remap: RemapResult


@dataclass(frozen=True, slots=True)
class JudgeInput:
    """The input handed to a :class:`SpanJudge` for a changed governing span.

    ``region_text`` is the Diff-selected changed+context region in *current*
    Draft coordinates (Requirement 17.5, REQ-DRAFT-DIFF-01) — never the whole
    Draft and never unchanged spans. ``anchor_span`` is the item's re-mapped
    span (current coords); ``selected_spans`` are the Diff-selected spans within
    the governing paragraph.
    """

    item: FeedbackItem
    paragraph_index: int
    region_text: str
    anchor_span: Span
    selected_spans: tuple[Span, ...] = field(default_factory=tuple)


@runtime_checkable
class SpanJudge(Protocol):
    """Injected model-judgment boundary (Requirement 17.5).

    A deterministic-by-contract callable that maps a :class:`JudgeInput` (the
    Diff-selected changed+context region) to one of ``RESOLVED`` /
    ``PARTIALLY_RESOLVED`` / ``STILL_UNRESOLVED``. Injecting it keeps the Progress
    Tracker pure and property-testable without invoking a real model, and lets
    tests assert the judge is NOT called for ``removed`` / ``unchanged`` items.
    """

    def __call__(self, judge_input: JudgeInput) -> ResolutionStatus: ...


@dataclass(frozen=True, slots=True)
class ResolutionUpdate:
    """The result of re-evaluating one Feedback Item against a new Draft.

    Exactly one per input item (Requirement 17.1, 17.2). ``category_id`` is
    carried through so the update can be appended to a :class:`ResolutionHistory`
    without re-joining to the item.
    """

    item_id: str
    category_id: str
    status: ResolutionStatus


@dataclass(frozen=True, slots=True)
class ResolutionEntry:
    """One append-only history record: a Feedback Item's status on one Draft.

    Mirrors the design "ResolutionStatusHistory" entity (append-only per
    ``(feedbackItemId, draftId)``). ``draft_version`` is the Draft's monotonic
    version number, giving a stable chronological ordering for pattern detection.
    """

    item_id: str
    category_id: str
    draft_version: int
    status: ResolutionStatus


@dataclass(frozen=True, slots=True)
class ResolutionHistory:
    """Append-only Resolution Status history across Drafts (Requirement 17.6).

    Immutable by construction: :meth:`record` and :meth:`append` return a NEW
    history whose entries are the existing entries plus the new ones, so prior
    history is never mutated, reordered, or dropped (append-only invariant).
    """

    entries: tuple[ResolutionEntry, ...] = ()

    def append(self, entry: ResolutionEntry) -> "ResolutionHistory":
        """Return a new history with ``entry`` appended (existing entries intact)."""
        return ResolutionHistory(self.entries + (entry,))

    def record(
        self, draft_version: int, updates: list[ResolutionUpdate]
    ) -> "ResolutionHistory":
        """Return a new history with one :class:`ResolutionEntry` per update.

        Convenience for persisting a whole :meth:`ProgressTracker.reevaluate`
        result for ``draft_version`` at once, preserving the append-only
        invariant (Requirement 17.6).
        """
        new_entries = tuple(
            ResolutionEntry(
                item_id=u.item_id,
                category_id=u.category_id,
                draft_version=draft_version,
                status=u.status,
            )
            for u in updates
        )
        return ResolutionHistory(self.entries + new_entries)

    @property
    def draft_versions(self) -> tuple[int, ...]:
        """The distinct Draft versions present, in ascending (chronological) order."""
        return tuple(sorted({e.draft_version for e in self.entries}))


@dataclass(frozen=True, slots=True)
class PatternAck:
    """A qualitative, non-numeric pattern acknowledgment for a category.

    Carries NO numeric score, grade, ranking, or comparison — the writer-facing
    progress experience is score-free (Requirement 18.3; the presenter enforces
    the surface, this type simply never provides a number to show).
    """

    category_id: str
    tendency: PatternTendency


class ProgressTracker:
    """Re-evaluate Feedback Items and recognize recurring patterns.

    Interface per design.md::

        class ProgressTracker:
            def reevaluate(self, items, diff, judge) -> list[ResolutionUpdate]: ...
            def detect_patterns(self, history) -> list[PatternAck]: ...

    Re-evaluation assigns exactly one :class:`ResolutionStatus` per item
    (Requirement 17.1, 17.2):

    * ``removed`` anchor → ``REMOVED`` (Requirement 17.3), never calling the judge.
    * governing span unchanged → ``UNCHANGED`` (Requirement 17.4), never calling
      the judge. A span is "unchanged" when its paragraph is unchanged, OR when
      the paragraph changed elsewhere but no changed region overlaps the item's
      anchored span.
    * governing span changed → the judge is called with the Diff-selected
      changed+context region (Requirement 17.5) and must return a judgment status.
    """

    def reevaluate(
        self,
        items: list[FeedbackItem],
        diff: Diff,
        judge: SpanJudge,
        *,
        context_window: int = DEFAULT_CONTEXT_WINDOW,
    ) -> list[ResolutionUpdate]:
        """Re-evaluate each Feedback Item against the new Draft (Requirement 17.1)."""
        curr_changes = {
            c.curr_index: c for c in diff.changes if c.curr_index is not None
        }
        curr_text_by_index = {
            c.curr_index: (c.curr_text or "")
            for c in diff.changes
            if c.curr_index is not None
        }

        # Diff-selected changed+context regions (REQ-DRAFT-DIFF-01), grouped by
        # current paragraph, computed once and reused for every changed item.
        selected_by_para: dict[int, list[Span]] = defaultdict(list)
        for span in DiffEngine().select_for_llm(diff, context_window):
            selected_by_para[span.paragraph_index].append(span)

        updates: list[ResolutionUpdate] = []
        for item in items:
            status = self._status_for(
                item, curr_changes, curr_text_by_index, selected_by_para, judge
            )
            updates.append(
                ResolutionUpdate(
                    item_id=item.item_id,
                    category_id=item.category_id,
                    status=status,
                )
            )
        return updates

    def _status_for(
        self,
        item: FeedbackItem,
        curr_changes: dict,
        curr_text_by_index: dict[int, str],
        selected_by_para: dict[int, list[Span]],
        judge: SpanJudge,
    ) -> ResolutionStatus:
        remap = item.remap

        # 17.3 — anchor removed by the Anchor Service → removed (never judge).
        if isinstance(remap, Removed):
            return ResolutionStatus.REMOVED

        # Defensive: only Remapped remains, but guard against unexpected shapes.
        if not isinstance(remap, Remapped):
            return ResolutionStatus.REMOVED

        span = remap.span
        change = curr_changes.get(span.paragraph_index)

        # 17.4 — governing paragraph absent from the diff or unchanged → unchanged
        # (never invoke the judge).
        if change is None or change.kind is ChangeKind.UNCHANGED:
            return ResolutionStatus.UNCHANGED

        # 17.4 (span-level) — paragraph changed elsewhere but no changed region
        # overlaps the item's anchored span → the governing span is unchanged.
        if change.kind is ChangeKind.CHANGED and not _overlaps_any(
            span, change.changed_spans
        ):
            return ResolutionStatus.UNCHANGED

        # 17.5 — the governing span changed: judge over the Diff-selected region.
        spans = tuple(selected_by_para.get(span.paragraph_index, ()))
        curr_text = curr_text_by_index.get(span.paragraph_index, "")
        region_text = "".join(curr_text[s.start:s.end] for s in spans) or curr_text
        verdict = judge(
            JudgeInput(
                item=item,
                paragraph_index=span.paragraph_index,
                region_text=region_text,
                anchor_span=span,
                selected_spans=spans,
            )
        )
        if verdict not in _JUDGMENT_STATUSES:
            raise ValueError(
                f"SpanJudge returned {verdict!r}; expected one of "
                f"{sorted(s.value for s in _JUDGMENT_STATUSES)}"
            )
        return verdict

    def detect_patterns(self, history: ResolutionHistory) -> list[PatternAck]:
        """Recognize improving / persistent / emerging tendencies (Requirement 18.2).

        Runs ONLY across two or more Drafts; with fewer than two Drafts it returns
        an empty list, making no pattern claims (Requirement 18.5). At most one
        acknowledgment is produced per category, in ascending category order for
        determinism. No numeric score is ever attached (Requirement 18.3).
        """
        versions = history.draft_versions
        if len(versions) < 2:
            # 18.5 — fewer than two Drafts: no pattern-level claims.
            return []

        latest = versions[-1]
        by_category: dict[str, list[ResolutionEntry]] = defaultdict(list)
        for entry in history.entries:
            by_category[entry.category_id].append(entry)

        acks: list[PatternAck] = []
        for category_id in sorted(by_category):
            entries = by_category[category_id]
            cat_versions = sorted({e.draft_version for e in entries})
            first_version = cat_versions[0]
            open_first = _open_count(entries, first_version)
            open_latest = _open_count(entries, latest)

            if first_version == latest:
                # The category first appears in the latest Draft only: a newly
                # emerging tendency (only acknowledged when it has open items).
                if open_latest > 0:
                    acks.append(PatternAck(category_id, PatternTendency.EMERGING))
                continue

            if open_latest < open_first:
                # Open items decreased across Drafts (including resolved to zero).
                acks.append(PatternAck(category_id, PatternTendency.IMPROVING))
            elif open_latest == 1 and open_first <= 1:
                # Only 1 item remains and it never grew — nearly resolved, not persistent.
                acks.append(PatternAck(category_id, PatternTendency.NEARLY_RESOLVED))
            elif open_first > 0 and open_latest > 0:
                # Open items persist across Drafts without decreasing.
                acks.append(PatternAck(category_id, PatternTendency.PERSISTENT))
            # Otherwise (e.g. resolved early and never recurring) → no claim.

        return acks


def _overlaps_any(span: Span, others: tuple[Span, ...]) -> bool:
    """True when ``span`` overlaps any of ``others`` (half-open ranges).

    A zero-width ``span`` (a pure-deletion change *location*) is treated as
    changed whenever a change region touches its position, so its governing item
    is judged rather than reported ``unchanged``.
    """
    for other in others:
        if span.start == span.end:
            if other.start <= span.start <= other.end:
                return True
        elif span.start < other.end and other.start < span.end:
            return True
    return False


def _open_count(entries: list[ResolutionEntry], draft_version: int) -> int:
    """Count still-open items (unresolved or partially resolved) on a Draft."""
    open_statuses = {
        ResolutionStatus.STILL_UNRESOLVED,
        ResolutionStatus.PARTIALLY_RESOLVED,
    }
    return sum(
        1
        for e in entries
        if e.draft_version == draft_version and e.status in open_statuses
    )
