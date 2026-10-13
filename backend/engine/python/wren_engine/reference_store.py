"""Reference material models and scoping (Task 10.1).

``wren_engine.debrief_budget.cap_reference_materials``. No embeddings are
computed or stored, there is no ``embedding`` table, and nothing in the
request path imports this module.

The models below describe the two-tier scoping rule from the spec and are kept
for ``CitationAttacher`` and the scoping property tests:

1. **Tier 1 (Department-wide)**: material shared across all Document Types
   within a Department. ``tier='department'``, ``department_id=<id>``,
   ``document_type_id=NULL``.

2. **Tier 2 (Document-Type-scoped)**: material specific to one Document
   Type. ``tier='type'``, ``department_id=<id>``, ``document_type_id=<id>``.

The **reference bundle** for a given Document Type is:
  ``tier_1 (department-wide) ∪ tier_2 (that Document Type's scoped material)``
— never another Document Type's material.

Design references:
  - requirements.md Requirement 20 (REQ-REFMAT-01), Requirement 22
    (REQ-REFMAT-SCOPE-01), Requirement 26 (REQ-REFMAT-MGMT-01).
  - design.md "Reference grounding (full-text)".
  - Property 21: Reference bundle scoping.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Sequence

__all__ = [
    "ReferenceTier",
    "ReferenceMaterial",
    "ReferenceChunk",
    "ReferenceBundle",
    "ReferenceBundleBuilder",
    "RetrievalResult",
]


class ReferenceTier(str, Enum):
    """The scope tier of a reference material entry.

    Values match the ``reference_material.tier`` CHECK constraint.
    """

    DEPARTMENT = "department"  # Tier 1: department-wide
    DOCUMENT_TYPE = "type"  # Tier 2: document-type-scoped


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
    """A section of reference material with its source's scoping metadata."""

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
    

    chunk: ReferenceChunk
    score: float  # Relevance score (higher = more relevant)
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
    The caller supplies the candidate materials; this builder filters and
    validates them.
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
