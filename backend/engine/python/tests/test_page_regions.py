"""Page header/footer reach the feedback prompt.

The header and footer are stored in ``draft.header`` / ``draft.footer``, outside
the body segments. Before this block existed the model never saw them, so a
running head or page numbers placed there were flagged as missing.

Asserts:
  - TipTap header/footer docs flatten to one sanitized line, with page-number
    and date chips rendered as placeholders.
  - With a header/footer, the prompt carries exactly one PAGE HEADER/FOOTER
    block plus the trusted directive (in the dynamic directives, never in the
    cached document-type block).
  - Without one, the prompt is byte-identical to the no-header/footer case.
  - The carry-forward document hash changes on a header/footer-only edit and
    is unchanged for drafts without one.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handler import (  # noqa: E402
    _document_hash_text,
    assemble_prompt,
    build_structured_prompt,
)
from wren_engine.page_regions import (  # noqa: E402
    MAX_PAGE_REGION_CHARS,
    PAGE_REGIONS_DIRECTIVE,
    PAGE_REGIONS_LABEL,
    PageRegions,
    build_page_regions_untrusted_content,
    page_region_text,
    page_regions_from_columns,
)


_MINIMAL_CONFIG = {
    "type_prompt_text": "You are WREN.",
    "tone": "supportive",
    "density": "moderate",
    "tone_description": "Be supportive.",
    "density_description": "",
    "category_priority": [],
    "structure_description": None,
    "restrictions_description": None,
    "notes_description": None,
    "updated_at": None,
    "temperature": 0.4,
    "bedrock_model_id": None,
}

_MINIMAL_DOC_TYPE_META = {
    "name": "APA Paper",
    "category_ids": ["cat-1"],
    "category_names": ["Formatting"],
    "category_guidance": {"cat-1": None},
}

_SAMPLE_SEGMENTS = [
    {"index": 0, "text": "Sleep deprivation impairs working memory."},
    {"index": 1, "text": "This effect is consistent across age groups."},
]


def _normalize(prompt):
    """Mask the per-call random boundary token."""
    return re.sub(r"\[[0-9a-f]{32}\]", "[TOKEN]", prompt)


def _doc(*paragraphs):
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": list(p)} for p in paragraphs],
    }


def _text(value):
    return {"type": "text", "text": value}


_HEADER_DOC = _doc([_text("SLEEP AND MEMORY "), {"type": "pageNumber"}])
_FOOTER_DOC = _doc([_text("PSYC 201")], [{"type": "date"}])


class TestPageRegionText:
    def test_placeholders_and_text(self):
        assert page_region_text(_HEADER_DOC) == "SLEEP AND MEMORY [page number]"

    def test_paragraphs_joined_on_one_line(self):
        assert page_region_text(_FOOTER_DOC) == "PSYC 201 / [date]"

    def test_hard_break_and_newlines_cannot_forge_lines(self):
        doc = _doc([_text("A\nB"), {"type": "hardBreak"}, _text("C\r\nD")])
        text = page_region_text(doc)
        assert "\n" not in text and "\r" not in text
        assert text == "A B / C D"

    def test_json_string_column(self):
        import json
        assert page_region_text(json.dumps(_HEADER_DOC)) == "SLEEP AND MEMORY [page number]"

    def test_empty_and_malformed(self):
        assert page_region_text(None) == ""
        assert page_region_text("not json") == ""
        assert page_region_text({"type": "doc", "content": [{"type": "paragraph"}]}) == ""
        assert page_regions_from_columns(None, None).is_empty()


class TestPageRegionsBlock:
    def test_none_when_empty(self):
        assert build_page_regions_untrusted_content(None) is None
        assert build_page_regions_untrusted_content(PageRegions()) is None

    def test_header_only(self):
        block = build_page_regions_untrusted_content(PageRegions(header="RUNNING HEAD"))
        assert block is not None
        assert block.label == PAGE_REGIONS_LABEL
        assert block.text == "HEADER (top of every page): RUNNING HEAD"

    def test_each_region_capped(self):
        block = build_page_regions_untrusted_content(
            PageRegions(header="x" * (MAX_PAGE_REGION_CHARS + 500))
        )
        assert block is not None
        assert len(block.text) < MAX_PAGE_REGION_CHARS + 100


class TestPromptAssemblyWithPageRegions:
    def _regions(self):
        return page_regions_from_columns(_HEADER_DOC, _FOOTER_DOC)

    def test_block_and_directive_present(self):
        prompt = assemble_prompt(
            _MINIMAL_CONFIG, _MINIMAL_DOC_TYPE_META, "", _SAMPLE_SEGMENTS, [],
            page_regions=self._regions(),
        )
        assert prompt.count(f"label={PAGE_REGIONS_LABEL}") == 1
        assert "HEADER (top of every page): SLEEP AND MEMORY [page number]" in prompt
        assert "FOOTER (bottom of every page): PSYC 201 / [date]" in prompt
        assert PAGE_REGIONS_DIRECTIVE in prompt

    def test_directive_is_dynamic_not_cached_config(self):
        structured = build_structured_prompt(
            _MINIMAL_CONFIG, _MINIMAL_DOC_TYPE_META, "", _SAMPLE_SEGMENTS, [],
            page_regions=self._regions(),
        )
        baseline = build_structured_prompt(
            _MINIMAL_CONFIG, _MINIMAL_DOC_TYPE_META, "", _SAMPLE_SEGMENTS, [],
        )
        assert PAGE_REGIONS_DIRECTIVE in structured.render()
        assert PAGE_REGIONS_DIRECTIVE not in baseline.render()
        # The stable, cacheable prefix is unchanged by a header/footer.
        assert structured.document_type == baseline.document_type

    def test_absent_is_byte_identical(self):
        baseline = assemble_prompt(
            _MINIMAL_CONFIG, _MINIMAL_DOC_TYPE_META, "", _SAMPLE_SEGMENTS, [],
        )
        for regions in (None, PageRegions(), page_regions_from_columns(None, None)):
            prompt = assemble_prompt(
                _MINIMAL_CONFIG, _MINIMAL_DOC_TYPE_META, "", _SAMPLE_SEGMENTS, [],
                page_regions=regions,
            )
            assert _normalize(prompt) == _normalize(baseline)
        assert PAGE_REGIONS_LABEL not in baseline


class TestDocumentHashText:
    def test_unchanged_without_regions(self):
        legacy = "\n".join(seg["text"] for seg in _SAMPLE_SEGMENTS)
        assert _document_hash_text(_SAMPLE_SEGMENTS) == legacy
        assert _document_hash_text(_SAMPLE_SEGMENTS, PageRegions()) == legacy

    def test_header_only_edit_changes_hash_text(self):
        before = _document_hash_text(_SAMPLE_SEGMENTS, PageRegions())
        after = _document_hash_text(_SAMPLE_SEGMENTS, PageRegions(header="RUNNING HEAD"))
        assert before != after
