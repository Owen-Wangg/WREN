"""Budgets that keep a debrief Bedrock call from running for minutes.

Long drafts were slow because the engine dumped every reference file into the
prompt and asked Claude for up to 16k output tokens. These helpers cap both.
"""
from __future__ import annotations

from typing import Any

__all__ = [
    "MAX_REFERENCE_TOTAL_CHARS",
    "MAX_REFERENCE_PER_FILE_CHARS",
    "MIN_DEBRIEF_MAX_TOKENS",
    "MAX_DEBRIEF_MAX_TOKENS",
    "cap_reference_materials",
    "debrief_max_tokens",
]

MAX_REFERENCE_TOTAL_CHARS = 12_000
MAX_REFERENCE_PER_FILE_CHARS = 4_000
MIN_DEBRIEF_MAX_TOKENS = 2560
MAX_DEBRIEF_MAX_TOKENS = 6144


def cap_reference_materials(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep reference dumps small enough that prefill does not dominate latency."""
    capped: list[dict[str, Any]] = []
    remaining = MAX_REFERENCE_TOTAL_CHARS
    for material in materials:
        if remaining <= 0:
            break
        content = str(material.get("content") or "")
        limit = min(MAX_REFERENCE_PER_FILE_CHARS, remaining)
        if len(content) > limit:
            trimmed = content[:limit].rsplit(" ", 1)[0]
            content = f"{trimmed}…" if trimmed else content[:limit]
            content = content[:limit]
        capped.append({**material, "content": content})
        remaining -= len(content)
    return capped


def debrief_max_tokens(*, inline_cap: int, category_count: int) -> int:
    """Size the Bedrock output budget from the item cap, not a 16k ceiling."""
    estimated_items = max(1, inline_cap) + max(category_count, 1) + 2
    return min(
        MAX_DEBRIEF_MAX_TOKENS,
        max(MIN_DEBRIEF_MAX_TOKENS, estimated_items * 150 + 200),
    )
