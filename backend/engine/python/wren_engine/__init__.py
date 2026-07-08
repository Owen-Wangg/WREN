"""Pure-logic engine for WREN Drafts: Diff Engine (+ Anchor Service, Progress Tracker).

Deterministic, dependency-free (standard-library ``difflib``) Python 3.12 logic that
runs in-region with no cloud calls and no per-Draft cost. The :class:`DiffEngine`
computes the paragraph + intra-paragraph change set between two consecutive Drafts
and selects the changed/added spans plus a bounded context window for the LLM,
excluding unchanged spans (Requirement 10 / REQ-DRAFT-DIFF-01).

The model dataclasses (:class:`Segment`, :class:`Span`, :class:`ParagraphChange`,
:class:`Diff`, :class:`ChangeKind`) are the shared vocabulary consumed by both the
LLM-selection step (Requirement 10.2) and, later, the Anchor Service, which uses the
prev->curr index mapping to re-map Anchors across Drafts (Requirement 10.5).

Design references:
  - design.md "Diff Engine, Anchor Service, Progress Tracker (Python 3.12)"
  - requirements.md Requirement 10 (REQ-DRAFT-DIFF-01)
"""
from .anchor_service import (
    Anchor,
    AnchorService,
    AnchorState,
    ContentFingerprint,
    Remapped,
    RemapResult,
    Removed,
    compute_fingerprint,
)
from .diff_engine import DiffEngine
from .models import ChangeKind, Diff, ParagraphChange, Segment, Span
from .progress_tracker import (
    DEFAULT_CONTEXT_WINDOW,
    FeedbackItem,
    JudgeInput,
    PatternAck,
    PatternTendency,
    ProgressTracker,
    ResolutionEntry,
    ResolutionHistory,
    ResolutionStatus,
    ResolutionUpdate,
    SpanJudge,
)

__all__ = [
    "DiffEngine",
    "Segment",
    "Span",
    "ParagraphChange",
    "Diff",
    "ChangeKind",
    # Anchor Service (Requirement 9 / REQ-ANCHOR-01)
    "AnchorService",
    "Anchor",
    "AnchorState",
    "ContentFingerprint",
    "Remapped",
    "Removed",
    "RemapResult",
    "compute_fingerprint",
    # Progress Tracker (Requirement 17 / REQ-RESOLUTION-01, 18 / REQ-PROGRESS-ACK-01)
    "ProgressTracker",
    "ResolutionStatus",
    "PatternTendency",
    "FeedbackItem",
    "JudgeInput",
    "SpanJudge",
    "ResolutionUpdate",
    "ResolutionEntry",
    "ResolutionHistory",
    "PatternAck",
    "DEFAULT_CONTEXT_WINDOW",
]
