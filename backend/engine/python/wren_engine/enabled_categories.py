"""Resolve which feedback categories are enabled for a debrief job.

The admin's saved selection (``config['category_priority']``) and the Document
Type's taxonomy (``doc_type_meta['category_ids']``) are combined into one
enabled set ``E``:

* ``S ∩ T`` in selection order when the selection names at least one current
  taxonomy category (an explicit selection that acts as a filter);
* ``T`` in taxonomy order when nothing is selected (``[]`` means "all on");
* ``T`` when every selected ID is stale (not in the taxonomy), flagged as a
  fallback so the caller can warn;
* ``S`` unchanged when the Document Type has no taxonomy (legacy behavior).

Every consumer (output budget, prompt taxonomy, strength coverage, density
trim, selection filter, quote safety net) uses this one resolver so they agree
on ``E``. The function is pure and never raises.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

__all__ = ["EnabledCategories", "resolve_enabled_categories"]


@dataclass(frozen=True)
class EnabledCategories:
    """The enabled category set for one job.

    Attributes:
        ids: The enabled set ``E``. Selection order when ``explicit``,
            taxonomy order otherwise.
        explicit: True when the selection intersects the taxonomy, so it acts
            as a filter. (In the legacy no-taxonomy case, true when the
            selection is non-empty.)
        stale_ids: Selected IDs not in the taxonomy (``S \\ T``), for logging.
        fell_back: True when a non-empty selection had no taxonomy IDs, so
            every taxonomy category is enabled.
    """

    ids: tuple[str, ...]
    explicit: bool
    stale_ids: tuple[str, ...]
    fell_back: bool

    @property
    def prompt_priority(self) -> tuple[str, ...]:
        """Priority IDs for the prompt: ``ids`` when explicit, else empty."""
        return self.ids if self.explicit else ()


def _normalize_ids(values: Any) -> tuple[str, ...]:
    """Strip, stringify, and ordered-dedup IDs; skip ``None`` and blanks.

    Accepts any iterable. A bare string is treated as a single ID. Anything
    that cannot be iterated, or an entry that cannot be stringified, is
    skipped rather than raising.
    """
    if values is None:
        return ()
    if isinstance(values, (str, bytes)):
        values = [values]
    try:
        iterator = iter(values)
    except TypeError:
        return ()

    seen: set[str] = set()
    out: list[str] = []
    while True:
        try:
            raw = next(iterator)
        except StopIteration:
            break
        except Exception:
            break
        if raw is None:
            continue
        try:
            if isinstance(raw, bytes):
                text = raw.decode("utf-8", errors="replace").strip()
            else:
                text = str(raw).strip()
        except Exception:
            continue
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return tuple(out)


def resolve_enabled_categories(
    category_priority: Optional[Iterable[Any]],
    taxonomy_ids: Optional[Iterable[Any]],
) -> EnabledCategories:
    """Combine the saved selection ``S`` with the taxonomy ``T`` into ``E``.

    See the module docstring for the rules. Pure; never raises; idempotent on
    ``set(ids)`` (feeding ``ids`` back in as the selection yields the same set).
    """
    taxonomy = _normalize_ids(taxonomy_ids)
    selection = _normalize_ids(category_priority)

    if not taxonomy:
        # Legacy Document Types with no taxonomy: keep the selection as-is.
        return EnabledCategories(
            ids=selection,
            explicit=bool(selection),
            stale_ids=(),
            fell_back=False,
        )

    if not selection:
        return EnabledCategories(
            ids=taxonomy, explicit=False, stale_ids=(), fell_back=False
        )

    taxonomy_set = set(taxonomy)
    kept = tuple(c for c in selection if c in taxonomy_set)
    stale = tuple(c for c in selection if c not in taxonomy_set)

    if not kept:
        return EnabledCategories(
            ids=taxonomy, explicit=False, stale_ids=stale, fell_back=True
        )

    return EnabledCategories(
        ids=kept, explicit=True, stale_ids=stale, fell_back=False
    )
