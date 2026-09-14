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

This package also hosts the Feedback Engine's non-generative building blocks
(Task 9 / design.md "Feedback Engine (Python 3.12, container Lambda)"):

  - :mod:`wren_engine.prompt_assembly` (Task 9.1) — pure, dependency-free
    layered prompt composition with untrusted-data isolation
    (REQ-PROMPT-EDIT-01 criterion 8, REQ-SEC-PROMPTINJECT-01).
  - :mod:`wren_engine.model_invocation` (Task 9.3) — model-agnostic Bedrock
    invocation via ``langchain-aws`` (REQ-NFR-MODEL-01). Its ``langchain-aws``
    dependency is imported lazily so importing ``wren_engine`` never requires
    the container-Lambda-only runtime dependency.
  - :mod:`wren_engine.async_job` (Task 9.12) — async job lifecycle
    (queued/in-progress/succeeded/failed/dead-lettered), idempotency-key
    derivation, and exponential-backoff-with-jitter, behind an injectable
    ``JobQueueClient`` protocol satisfied in production by an SQS + DLQ
    adapter (provisioned by the CDK `Compute` stack, Task 16.2).

Design references:
  - design.md "Diff Engine, Anchor Service, Progress Tracker (Python 3.12)"
  - design.md "Feedback Engine (Python 3.12, container Lambda)"
  - requirements.md Requirement 10 (REQ-DRAFT-DIFF-01), Requirement 51
    (REQ-NFR-MODEL-01)
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
from .async_job import (
    DEFAULT_BASE_DELAY_SECONDS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_MAX_DELAY_SECONDS,
    AsyncFeedbackJobRunner,
    FeedbackJob,
    IdempotencyKey,
    InMemoryJobQueueClient,
    JobQueueClient,
    JobResult,
    JobStatus,
    compute_backoff_delay,
    derive_idempotency_key,
)
from .diff_engine import DiffEngine
from .model_invocation import (
    LangChainBedrockInvoker,
    ModelInvocationError,
    ModelInvoker,
    ModelReply,
    bedrock_model_id_parameter_name,
    resolve_bedrock_model_id,
)
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
from .carry_forward import (
    CacheKey,
    CachedFeedbackItem,
    CarryForwardCache,
    CarryForwardDecision,
    ConfigSnapshot,
)
from .citation_attachment import (
    Citation,
    CitationAttacher,
    CitedFeedbackItem,
    CitedStructuralItem,
    RELEVANCE_THRESHOLD,
)
from .feedback_classifier import (
    ClassificationOutcome,
    DensityOutcome,
    DensitySetting,
    FeedbackClassifier,
    compute_density_cap,
)
from .footnote_metadata import (
    FootnoteMetadata,
    build_footnotes_untrusted_content,
)
from .output_guardrail import (
    GuardrailAuditSink,
    GuardrailOutcome,
    GuardrailViolation,
    OutputGuardrail,
    ValidatedFeedbackItem,
    ViolationType,
)
from .prompt_assembly import (
    AssembledPrompt,
    StructuredFeedbackPrompt,
    DocumentTypePromptConfig,
    PromptAssembler,
    SystemScaffolding,
    UntrustedContent,
)
from .reference_store import (
    EMBEDDING_TABLE_MIGRATION_SQL,
    ReferenceBundle,
    ReferenceBundleBuilder,
    ReferenceChunk,
    ReferenceMaterial,
    ReferenceStore,
    ReferenceTier,
    RetrievalResult,
)
from .structural_feedback import (
    DEFAULT_STRUCTURAL_CAP,
    FeedbackPartition,
    StructuralFeedbackItem,
    StructuralFeedbackProcessor,
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
    # Prompt assembly (Requirement 25.5, 32.8, 38.1-38.2 / Task 9.1)
    "PromptAssembler",
    "SystemScaffolding",
    "DocumentTypePromptConfig",
    "UntrustedContent",
    "AssembledPrompt",
    "StructuredFeedbackPrompt",
    # Model invocation (Requirement 51 / REQ-NFR-MODEL-01 / Task 9.3)
    "ModelInvoker",
    "LangChainBedrockInvoker",
    "ModelReply",
    "ModelInvocationError",
    "resolve_bedrock_model_id",
    "bedrock_model_id_parameter_name",
    # Output guardrail (Requirement 11 / REQ-CORE-NOGHOST-01 / Task 9.4)
    "OutputGuardrail",
    "GuardrailOutcome",
    "GuardrailViolation",
    "GuardrailAuditSink",
    "ValidatedFeedbackItem",
    "ViolationType",
    # Feedback classifier (Requirement 13, 15 / Task 9.6)
    "FeedbackClassifier",
    "ClassificationOutcome",
    "DensityOutcome",
    "DensitySetting",
    "compute_density_cap",
    # Footnote/citation metadata (footnote-citation-support spec, Task 9.1)
    "FootnoteMetadata",
    "build_footnotes_untrusted_content",
    # Structural feedback (Requirement 14 / REQ-FB-STRUCTURAL-01 / Task 9.9)
    "StructuralFeedbackProcessor",
    "StructuralFeedbackItem",
    "FeedbackPartition",
    "DEFAULT_STRUCTURAL_CAP",
    # Carry-forward caching (Requirement 49 / REQ-NFR-COST-01 / Task 9.10)
    "CarryForwardCache",
    "CarryForwardDecision",
    "CachedFeedbackItem",
    "CacheKey",
    "ConfigSnapshot",
    # Two-tier reference store (Requirement 20, 22 / Task 10.1)
    "ReferenceStore",
    "ReferenceBundleBuilder",
    "ReferenceBundle",
    "ReferenceMaterial",
    "ReferenceChunk",
    "ReferenceTier",
    "RetrievalResult",
    "EMBEDDING_TABLE_MIGRATION_SQL",
    # Citation attachment (Requirement 21 / REQ-REFMAT-CITE-01 / Task 10.3)
    "CitationAttacher",
    "Citation",
    "CitedFeedbackItem",
    "CitedStructuralItem",
    "RELEVANCE_THRESHOLD",
    # Async feedback job execution (Requirement 47, 48 / Task 9.12)
    "AsyncFeedbackJobRunner",
    "FeedbackJob",
    "JobStatus",
    "JobResult",
    "JobQueueClient",
    "InMemoryJobQueueClient",
    "IdempotencyKey",
    "derive_idempotency_key",
    "compute_backoff_delay",
    "DEFAULT_MAX_ATTEMPTS",
    "DEFAULT_BASE_DELAY_SECONDS",
    "DEFAULT_MAX_DELAY_SECONDS",
]
