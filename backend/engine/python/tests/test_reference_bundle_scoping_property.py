"""Property test: Reference bundle scoping (Task 10.2 / Property 21).

For any set of candidate Reference Material and any target
(department_id, document_type_id) pair, the ReferenceBundleBuilder
produces a bundle whose materials are exactly:

    tier-1 (department-wide) materials belonging to that department
    UNION
    tier-2 (document-type-scoped) materials belonging to that department
    AND that document type

— never a tier-2 material from a different Document Type, and never any
material (tier 1 or tier 2) from a different Department.

Validates: Requirements 22.2, 22.3, 20.4, 26.3

Feature: wren-writing-coach, Property 21
"""
from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from wren_engine.reference_store import (
    ReferenceBundleBuilder,
    ReferenceMaterial,
    ReferenceTier,
)


# ─── Strategies ────────────────────────────────────────────────────────────────

_ids = st.text(alphabet=st.characters(whitelist_categories=("Ll", "Nd")), min_size=1, max_size=6)

_department_ids = st.sampled_from(["dept-a", "dept-b", "dept-c"])
_document_type_ids = st.sampled_from(["dt-1", "dt-2", "dt-3", "dt-4"])
_tiers = st.sampled_from([ReferenceTier.DEPARTMENT, ReferenceTier.DOCUMENT_TYPE])


def _material_strategy():
    def build(mat_id, title, tier, dept_id, dt_id):
        # DOCUMENT_TYPE tier materials require a document_type_id;
        # DEPARTMENT tier materials never carry one.
        resolved_dt_id = dt_id if tier == ReferenceTier.DOCUMENT_TYPE else None
        return ReferenceMaterial(
            id=mat_id,
            title=title or "untitled",
            tier=tier,
            department_id=dept_id,
            document_type_id=resolved_dt_id,
        )

    return st.builds(
        build,
        mat_id=_ids,
        title=st.text(min_size=1, max_size=10).filter(lambda s: s.strip() != ""),
        tier=_tiers,
        dept_id=_department_ids,
        dt_id=_document_type_ids,
    )


_materials_lists = st.lists(_material_strategy(), min_size=0, max_size=25)


def _dedupe_by_id(materials: list[ReferenceMaterial]) -> list[ReferenceMaterial]:
    """ReferenceMaterial ids should be unique within a candidate set;
    Hypothesis may generate duplicate ids with different bodies, so keep
    the first occurrence per id to make bundle-membership assertions
    well-defined."""
    seen: set[str] = set()
    result: list[ReferenceMaterial] = []
    for m in materials:
        if m.id in seen:
            continue
        seen.add(m.id)
        result.append(m)
    return result


@pytest.mark.property
class TestReferenceBundleScopingProperty:
    """Property 21: Reference bundle scoping (REQ-REFMAT-SCOPE-01)."""

    # Feature: wren-writing-coach, Property 21: Reference bundle scoping

    @settings(max_examples=200)
    @given(
        candidates=_materials_lists,
        department_id=_department_ids,
        document_type_id=_document_type_ids,
    )
    def test_bundle_contains_only_correctly_scoped_materials(
        self,
        candidates: list[ReferenceMaterial],
        department_id: str,
        document_type_id: str,
    ) -> None:
        """Every material in the resulting bundle satisfies the scoping rule:
        department-wide material in the target department, or document-type
        material in the target department AND target document type."""
        candidates = _dedupe_by_id(candidates)
        builder = ReferenceBundleBuilder()

        bundle = builder.build(
            department_id=department_id,
            document_type_id=document_type_id,
            candidate_materials=candidates,
        )

        for mat in bundle.all_materials:
            assert mat.department_id == department_id
            if mat.tier == ReferenceTier.DOCUMENT_TYPE:
                assert mat.document_type_id == document_type_id
            # tier == DEPARTMENT materials carry no document_type_id constraint

    @settings(max_examples=200)
    @given(
        candidates=_materials_lists,
        department_id=_department_ids,
        document_type_id=_document_type_ids,
    )
    def test_bundle_never_includes_other_document_types_materials(
        self,
        candidates: list[ReferenceMaterial],
        department_id: str,
        document_type_id: str,
    ) -> None:
        """A tier-2 material scoped to a different Document Type must never
        appear in the bundle, even if it shares the target Department."""
        candidates = _dedupe_by_id(candidates)
        builder = ReferenceBundleBuilder()

        bundle = builder.build(
            department_id=department_id,
            document_type_id=document_type_id,
            candidate_materials=candidates,
        )

        bundle_ids = {mat.id for mat in bundle.all_materials}
        for mat in candidates:
            if (
                mat.tier == ReferenceTier.DOCUMENT_TYPE
                and mat.document_type_id != document_type_id
            ):
                assert mat.id not in bundle_ids

    @settings(max_examples=200)
    @given(
        candidates=_materials_lists,
        department_id=_department_ids,
        document_type_id=_document_type_ids,
    )
    def test_bundle_never_includes_other_departments_materials(
        self,
        candidates: list[ReferenceMaterial],
        department_id: str,
        document_type_id: str,
    ) -> None:
        """No material from a different Department leaks into the bundle,
        regardless of tier."""
        candidates = _dedupe_by_id(candidates)
        builder = ReferenceBundleBuilder()

        bundle = builder.build(
            department_id=department_id,
            document_type_id=document_type_id,
            candidate_materials=candidates,
        )

        bundle_ids = {mat.id for mat in bundle.all_materials}
        for mat in candidates:
            if mat.department_id != department_id:
                assert mat.id not in bundle_ids

    @settings(max_examples=200)
    @given(
        candidates=_materials_lists,
        department_id=_department_ids,
        document_type_id=_document_type_ids,
    )
    def test_bundle_is_exactly_the_union_of_matching_materials(
        self,
        candidates: list[ReferenceMaterial],
        department_id: str,
        document_type_id: str,
    ) -> None:
        """The bundle equals precisely the set of candidates that satisfy the
        scoping predicate — nothing included that shouldn't be, nothing
        excluded that should be included (completeness, not just safety)."""
        candidates = _dedupe_by_id(candidates)
        builder = ReferenceBundleBuilder()

        bundle = builder.build(
            department_id=department_id,
            document_type_id=document_type_id,
            candidate_materials=candidates,
        )

        expected_ids = {
            mat.id
            for mat in candidates
            if mat.department_id == department_id
            and (
                mat.tier == ReferenceTier.DEPARTMENT
                or (
                    mat.tier == ReferenceTier.DOCUMENT_TYPE
                    and mat.document_type_id == document_type_id
                )
            )
        }
        actual_ids = {mat.id for mat in bundle.all_materials}
        assert actual_ids == expected_ids

    @settings(max_examples=150)
    @given(
        candidates=_materials_lists,
        department_id=_department_ids,
        document_type_id=_document_type_ids,
    )
    def test_department_materials_property_holds_tier_partition(
        self,
        candidates: list[ReferenceMaterial],
        department_id: str,
        document_type_id: str,
    ) -> None:
        """department_materials contains only DEPARTMENT-tier entries and
        document_type_materials contains only DOCUMENT_TYPE-tier entries —
        the two tiers are never mixed up in the bundle's structure."""
        candidates = _dedupe_by_id(candidates)
        builder = ReferenceBundleBuilder()

        bundle = builder.build(
            department_id=department_id,
            document_type_id=document_type_id,
            candidate_materials=candidates,
        )

        assert all(m.tier == ReferenceTier.DEPARTMENT for m in bundle.department_materials)
        assert all(m.tier == ReferenceTier.DOCUMENT_TYPE for m in bundle.document_type_materials)

    @settings(max_examples=100)
    @given(department_id=_department_ids, document_type_id=_document_type_ids)
    def test_empty_candidates_yields_empty_bundle(
        self, department_id: str, document_type_id: str
    ) -> None:
        """No candidates in -> an empty (but well-formed) bundle out."""
        builder = ReferenceBundleBuilder()

        bundle = builder.build(
            department_id=department_id,
            document_type_id=document_type_id,
            candidate_materials=[],
        )

        assert bundle.is_empty
        assert bundle.all_materials == ()
