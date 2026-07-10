"""Two-tier reference store and grounding (Task 10.1).

Implements the reference material retrieval layer that feeds grounded
citations to the Feedback Engine. Reference Material is organized in
two tiers:

1. **Tier 1 (Department-wide)**: material shared across all Document Types
   within a Department. Stored with ``tier='department'``,
   ``department_id=<id>``, ``document_type_id=NULL``.

2. **Tier 2 (Document-Type-scoped)**: material specific to one Document
   Type. Stored with ``tier='document_type'``, ``department_id=<id>``,
   ``document_type_id=<id>``.

The **reference bundle** for a given Document Type is:
  ``tier_1 (department-wide) ∪ tier_2 (that Document Type's scoped material)``
— never another Document Type's material.

All embeddings live in a **single** ``pgvector``-backed ``embedding`` table
(managed through a LlamaIndex ``PGVectorStore``). Scoped retrieval uses
a WHERE filter on ``tier``/``department_id``/``document_type_id``.

This module defines:
- The data models for reference materials and their chunks/embeddings.
- The ``ReferenceBundle`` and scoping logic (pure, no DB).
- The ``ReferenceStore`` protocol for persistence (implemented by callers).
- The migration schema for the ``embedding`` table.

Design references:
  - design.md Section 10: "Department-wide (tier 1) and Document-Type-scoped
    (tier 2) Reference Material; parse/chunk/index content with LlamaIndex
    into the single pgvector-backed embedding table."
  - requirements.md Requirement 20 (REQ-REFMAT-01), Requirement 22
    (REQ-REFMAT-SCOPE-01), Requirement 26 (REQ-REFMAT-MGMT-01).
  - Property 21: Reference bundle scoping.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Protocol, Sequence

__all__ = [
    "ReferenceTier",
    "ReferenceMaterial",
    "ReferenceChunk",
    "ReferenceBundle",
    "ReferenceBundleBuilder",
    "ReferenceStore",
    "RetrievalResult",
    "EMBEDDING_TABLE_MIGRATION_SQL",
]


class ReferenceTier(str, Enum):
    """The scope tier of a reference material entry."""

    DEPARTMENT = "department"  # Tier 1: department-wide
    DOCUMENT_TYPE = "document_type"  # Tier 2: document-type-scoped


@dataclass(frozen=True, slots=True)
class ReferenceMaterial:
    """A reference material entry (document, guide, policy, etc.).

    Each material belongs to exactly one tier and is scoped to either
    a Department (tier 1) or a specific Document Type (tier 2).
    """

    id: str
    title: str
    tier: ReferenceTier
    department_id: str
    document_type_id: Optional[str]  # None for tier 1 (department-wide)
    content_type: str = "text"  # text, pdf, docx, html
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("id must not be empty")
        if not self.title.strip():
            raise ValueError("title must not be empty")
        if not self.department_id:
            raise ValueError("department_id must not be empty")
        if self.tier == ReferenceTier.DOCUMENT_TYPE and not self.document_type_id:
            raise ValueError(
                "document_type_id is required for DOCUMENT_TYPE tier materials"
            )


@dataclass(frozen=True, slots=True)
class ReferenceChunk:
    """A chunk of reference material, ready for embedding.

    Each reference material is split into chunks for embedding/retrieval.
    Chunks carry their source material's scoping metadata so the embedding
    table can be filtered without a join.
    """

    reference_material_id: str
    chunk_index: int
    content: str
    tier: ReferenceTier
    department_id: str
    document_type_id: Optional[str]
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def source_title(self) -> str:
        """The title from metadata, if available."""
        return self.metadata.get("title", "")

    @property
    def source_section(self) -> str:
        """The section/heading from metadata, if available."""
        return self.metadata.get("section", "")


@dataclass(frozen=True, slots=True)
class RetrievalResult:
    """A single retrieval result from the embedding store.

    Returned by similarity search and used to ground citations.
    """

    chunk: ReferenceChunk
    score: float  # Similarity score (higher = more similar)
    material_title: str
    section: str = ""


@dataclass(frozen=True, slots=True)
class ReferenceBundle:
    """The complete reference bundle for a Document Type's feedback generation.

    Bundle = department-wide material (tier 1) ∪ that Document Type's
    scoped material (tier 2). Never includes another Document Type's
    tier 2 material (REQ-REFMAT-SCOPE-01 criteria 22.2, 22.3).
    """

    department_id: str
    document_type_id: str
    department_materials: tuple[ReferenceMaterial, ...]  # Tier 1
    document_type_materials: tuple[ReferenceMaterial, ...]  # Tier 2

    @property
    def all_materials(self) -> tuple[ReferenceMaterial, ...]:
        """All materials in the bundle (tier 1 + tier 2)."""
        return self.department_materials + self.document_type_materials

    @property
    def is_empty(self) -> bool:
        return len(self.all_materials) == 0


class ReferenceBundleBuilder:
    """Builds the correctly scoped reference bundle for a Document Type.

    Pure logic — validates scoping invariants without any I/O.
    The caller supplies the candidate materials (from DB/store);
    this builder filters and validates them.
    """

    def build(
        self,
        *,
        department_id: str,
        document_type_id: str,
        candidate_materials: Sequence[ReferenceMaterial],
    ) -> ReferenceBundle:
        """Build a reference bundle from candidate materials.

        Filters candidates to include only:
        - Tier 1 materials belonging to the specified department.
        - Tier 2 materials belonging to the specified document type
          within the specified department.

        Rejects (excludes without error):
        - Tier 2 materials from other document types (REQ-REFMAT-SCOPE-01
          criterion 22.3: "never another type's").
        - Materials from other departments.
        """
        dept_materials: list[ReferenceMaterial] = []
        dt_materials: list[ReferenceMaterial] = []

        for mat in candidate_materials:
            # Must be in the correct department
            if mat.department_id != department_id:
                continue

            if mat.tier == ReferenceTier.DEPARTMENT:
                dept_materials.append(mat)
            elif mat.tier == ReferenceTier.DOCUMENT_TYPE:
                # Only include if it belongs to THIS document type
                if mat.document_type_id == document_type_id:
                    dt_materials.append(mat)
                # Otherwise: belongs to a different type — excluded

        return ReferenceBundle(
            department_id=department_id,
            document_type_id=document_type_id,
            department_materials=tuple(dept_materials),
            document_type_materials=tuple(dt_materials),
        )


class ReferenceStore(Protocol):
    """Protocol for the reference material persistence layer.

    Production implementations use LlamaIndex PGVectorStore over the
    single ``embedding`` table. This protocol allows the engine to
    remain testable without a live database.
    """

    def retrieve_similar(
        self,
        *,
        query_text: str,
        department_id: str,
        document_type_id: str,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        """Retrieve the most similar chunks from the reference bundle.

        Scoped query: only searches embeddings where:
        - tier='department' AND department_id=<id>, OR
        - tier='document_type' AND document_type_id=<id>

        Returns results ordered by descending similarity score.
        """
        ...

    def index_material(
        self,
        material: ReferenceMaterial,
        chunks: list[ReferenceChunk],
    ) -> None:
        """Index a reference material's chunks into the embedding store."""
        ...

    def remove_material(self, material_id: str) -> None:
        """Remove a material and all its chunks/embeddings from the store."""
        ...


# ─── Database Migration SQL ────────────────────────────────────────────────────

EMBEDDING_TABLE_MIGRATION_SQL = """
-- Forward-only migration: create the single embedding table for reference
-- material chunks (Task 10.1). Uses pgvector for similarity search.
-- This table is managed through a LlamaIndex PGVectorStore but created
-- via explicit migration for schema control.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embedding (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_material_id UUID NOT NULL,
    tier            VARCHAR(20) NOT NULL CHECK (tier IN ('department', 'document_type')),
    department_id   UUID NOT NULL,
    document_type_id UUID,  -- NULL for tier='department' (department-wide)
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    embedding       vector(1536),  -- Dimension matches common embedding models
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Scoping constraints
    CONSTRAINT embedding_tier_scope_check CHECK (
        (tier = 'department' AND document_type_id IS NULL) OR
        (tier = 'document_type' AND document_type_id IS NOT NULL)
    ),

    -- Foreign keys (reference_material must exist)
    CONSTRAINT fk_embedding_reference_material
        FOREIGN KEY (reference_material_id) REFERENCES reference_material(id)
        ON DELETE CASCADE
);

-- Indexes for scoped retrieval (the WHERE filter that enforces bundle scoping)
CREATE INDEX IF NOT EXISTS idx_embedding_dept_tier
    ON embedding (department_id, tier);

CREATE INDEX IF NOT EXISTS idx_embedding_doctype
    ON embedding (document_type_id)
    WHERE document_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_embedding_ref_material
    ON embedding (reference_material_id);

-- HNSW index for approximate nearest neighbor search via pgvector
CREATE INDEX IF NOT EXISTS idx_embedding_vector_hnsw
    ON embedding USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
"""
