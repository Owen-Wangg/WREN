"""Tests for two-tier reference store and citation attachment (Tasks 10.1, 10.3).

Validates that:
- ReferenceBundleBuilder correctly scopes tier 1 (dept) and tier 2 (type) materials
- Materials from other departments/types are excluded
- CitationAttacher attaches citations when above threshold
- CitationAttacher does NOT attach when below threshold or no results
- Citations contain only source identity (title/section), never prose
"""
import pytest

from wren_engine.citation_attachment import (
    Citation,
    CitationAttacher,
    CitedFeedbackItem,
    RELEVANCE_THRESHOLD,
)
from wren_engine.output_guardrail import ValidatedFeedbackItem
from wren_engine.reference_store import (
    ReferenceBundle,
    ReferenceBundleBuilder,
    ReferenceChunk,
    ReferenceMaterial,
    ReferenceTier,
    RetrievalResult,
)
from wren_engine.structural_feedback import StructuralFeedbackItem


# ─── Reference Bundle Builder ──────────────────────────────────────────────────


class TestReferenceBundleBuilder:
    def test_includes_dept_wide_tier_1_materials(self) -> None:
        builder = ReferenceBundleBuilder()
        mat = ReferenceMaterial(
            id="m1",
            title="Department Guide",
            tier=ReferenceTier.DEPARTMENT,
            department_id="dept-1",
            document_type_id=None,
        )

        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[mat],
        )

        assert len(bundle.department_materials) == 1
        assert bundle.department_materials[0].id == "m1"

    def test_includes_type_scoped_tier_2_materials(self) -> None:
        builder = ReferenceBundleBuilder()
        mat = ReferenceMaterial(
            id="m2",
            title="Legal Style Guide",
            tier=ReferenceTier.DOCUMENT_TYPE,
            department_id="dept-1",
            document_type_id="dt-1",
        )

        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[mat],
        )

        assert len(bundle.document_type_materials) == 1
        assert bundle.document_type_materials[0].id == "m2"

    def test_excludes_other_departments_materials(self) -> None:
        builder = ReferenceBundleBuilder()
        mat = ReferenceMaterial(
            id="m3",
            title="Other Dept Guide",
            tier=ReferenceTier.DEPARTMENT,
            department_id="dept-OTHER",
            document_type_id=None,
        )

        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[mat],
        )

        assert len(bundle.all_materials) == 0

    def test_excludes_other_document_types_tier_2(self) -> None:
        """Never another type's material (REQ-REFMAT-SCOPE-01 criterion 22.3)."""
        builder = ReferenceBundleBuilder()
        mat = ReferenceMaterial(
            id="m4",
            title="Other Type's Guide",
            tier=ReferenceTier.DOCUMENT_TYPE,
            department_id="dept-1",
            document_type_id="dt-OTHER",
        )

        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[mat],
        )

        assert len(bundle.all_materials) == 0

    def test_builds_full_bundle_with_both_tiers(self) -> None:
        builder = ReferenceBundleBuilder()
        dept_mat = ReferenceMaterial(
            id="m1",
            title="Dept Guide",
            tier=ReferenceTier.DEPARTMENT,
            department_id="dept-1",
            document_type_id=None,
        )
        type_mat = ReferenceMaterial(
            id="m2",
            title="Type Guide",
            tier=ReferenceTier.DOCUMENT_TYPE,
            department_id="dept-1",
            document_type_id="dt-1",
        )
        other_type_mat = ReferenceMaterial(
            id="m3",
            title="Other Type Guide",
            tier=ReferenceTier.DOCUMENT_TYPE,
            department_id="dept-1",
            document_type_id="dt-2",
        )

        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[dept_mat, type_mat, other_type_mat],
        )

        assert len(bundle.department_materials) == 1
        assert len(bundle.document_type_materials) == 1
        assert len(bundle.all_materials) == 2
        # Other type's material excluded
        assert all(m.id != "m3" for m in bundle.all_materials)

    def test_empty_candidates(self) -> None:
        builder = ReferenceBundleBuilder()
        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[],
        )
        assert bundle.is_empty

    def test_bundle_properties(self) -> None:
        builder = ReferenceBundleBuilder()
        bundle = builder.build(
            department_id="dept-1",
            document_type_id="dt-1",
            candidate_materials=[],
        )
        assert bundle.department_id == "dept-1"
        assert bundle.document_type_id == "dt-1"


# ─── ReferenceMaterial validation ──────────────────────────────────────────────


class TestReferenceMaterialValidation:
    def test_tier_2_requires_document_type_id(self) -> None:
        with pytest.raises(ValueError, match="document_type_id is required"):
            ReferenceMaterial(
                id="m1",
                title="Guide",
                tier=ReferenceTier.DOCUMENT_TYPE,
                department_id="dept-1",
                document_type_id=None,  # Missing!
            )

    def test_empty_title_raises(self) -> None:
        with pytest.raises(ValueError, match="title must not be empty"):
            ReferenceMaterial(
                id="m1",
                title="   ",
                tier=ReferenceTier.DEPARTMENT,
                department_id="dept-1",
                document_type_id=None,
            )

    def test_empty_id_raises(self) -> None:
        with pytest.raises(ValueError, match="id must not be empty"):
            ReferenceMaterial(
                id="",
                title="Guide",
                tier=ReferenceTier.DEPARTMENT,
                department_id="dept-1",
                document_type_id=None,
            )


# ─── Citation Attachment ───────────────────────────────────────────────────────


class TestCitationAttacher:
    def _retrieval_result(
        self,
        title: str = "Smith v. Jones",
        section: str = "para 12",
        score: float = 0.85,
    ) -> RetrievalResult:
        chunk = ReferenceChunk(
            reference_material_id="ref-1",
            chunk_index=0,
            content="Some reference content.",
            tier=ReferenceTier.DEPARTMENT,
            department_id="dept-1",
            document_type_id=None,
            metadata={"title": title, "section": section},
        )
        return RetrievalResult(
            chunk=chunk,
            score=score,
            material_title=title,
            section=section,
        )

    def test_attaches_citation_above_threshold(self) -> None:
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Citation",
            question="What source supports this?",
            anchor={"start": 0, "end": 50},
            citation=None,
        )
        results = [self._retrieval_result(score=0.9)]

        cited = attacher.attach_citations([item], results)

        assert len(cited) == 1
        assert cited[0].has_citation
        assert cited[0].citation.title == "Smith v. Jones"
        assert cited[0].citation.section == "para 12"

    def test_no_citation_below_threshold(self) -> None:
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Grammar",
            question="Is this correct?",
            anchor={"start": 0, "end": 50},
            citation=None,
        )
        results = [self._retrieval_result(score=0.3)]  # Below threshold

        cited = attacher.attach_citations([item], results)

        assert len(cited) == 1
        assert not cited[0].has_citation
        assert cited[0].citation is None

    def test_no_citation_with_empty_results(self) -> None:
        """Requirement 21.4: no citation when none informed it."""
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Grammar",
            question="Is this correct?",
            anchor=None,
            citation=None,
        )

        cited = attacher.attach_citations([item], [])

        assert not cited[0].has_citation

    def test_uses_model_provided_citation_if_valid(self) -> None:
        """If the model already attached a citation, validate and use it."""
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Citation",
            question="Check this reference?",
            anchor=None,
            citation={"title": "Brown v. Board", "section": "Ch 4"},
        )

        cited = attacher.attach_citations([item], [])

        assert cited[0].has_citation
        assert cited[0].citation.title == "Brown v. Board"
        assert cited[0].citation.section == "Ch 4"

    def test_selects_highest_scoring_result(self) -> None:
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Accuracy",
            question="Is this claim supported?",
            anchor=None,
            citation=None,
        )
        results = [
            self._retrieval_result(title="Low Score", score=0.7),
            self._retrieval_result(title="High Score", score=0.95),
            self._retrieval_result(title="Mid Score", score=0.8),
        ]

        cited = attacher.attach_citations([item], results)

        assert cited[0].citation.title == "High Score"

    def test_custom_threshold(self) -> None:
        attacher = CitationAttacher(relevance_threshold=0.9)
        item = ValidatedFeedbackItem(
            category="Test",
            question="Q?",
            anchor=None,
            citation=None,
        )
        # Score 0.85 — below our custom 0.9 threshold
        results = [self._retrieval_result(score=0.85)]

        cited = attacher.attach_citations([item], results)
        assert not cited[0].has_citation

    def test_invalid_threshold_raises(self) -> None:
        with pytest.raises(ValueError, match="between 0.0 and 1.0"):
            CitationAttacher(relevance_threshold=1.5)

    def test_to_validated_item_with_citation(self) -> None:
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Test",
            question="Q?",
            anchor={"start": 0, "end": 10},
            citation=None,
        )
        results = [self._retrieval_result(score=0.9)]

        cited = attacher.attach_citations([item], results)
        validated = cited[0].to_validated_item()

        assert validated.citation == {"title": "Smith v. Jones", "section": "para 12"}
        assert validated.category == "Test"
        assert validated.anchor == {"start": 0, "end": 10}

    def test_to_validated_item_without_citation(self) -> None:
        attacher = CitationAttacher()
        item = ValidatedFeedbackItem(
            category="Test",
            question="Q?",
            anchor=None,
            citation=None,
        )

        cited = attacher.attach_citations([item], [])
        validated = cited[0].to_validated_item()

        assert validated.citation is None


# ─── Citation validation ───────────────────────────────────────────────────────


class TestCitationValidation:
    def test_empty_title_raises(self) -> None:
        with pytest.raises(ValueError, match="title must not be empty"):
            Citation(title="")

    def test_whitespace_title_raises(self) -> None:
        with pytest.raises(ValueError, match="title must not be empty"):
            Citation(title="   ")

    def test_to_dict_with_section(self) -> None:
        c = Citation(title="Guide", section="Chapter 3")
        assert c.to_dict() == {"title": "Guide", "section": "Chapter 3"}

    def test_to_dict_without_section(self) -> None:
        c = Citation(title="Guide", section=None)
        assert c.to_dict() == {"title": "Guide"}
