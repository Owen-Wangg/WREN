# Historical specs

The folders under `docs/specs/` are the original Kiro-style **requirements / design / tasks** packages used while building the platform. They are kept for history and implementation traceability. They are **not** the live user, API, or deployment guides.

Current product documentation:

- [User Guide](../user-guide.md)
- [Architecture Deep Dive](../architecture-deep-dive.md)
- [Debrief pipeline](../DEBRIEF_ARCHITECTURE_DEEP_DIVE.md)
- [Deployment Guide](../deployment-guide.md)
- [REST API](../api-guide.md)

| Spec folder | What it described |
| --- | --- |
| `wren-writing-coach/` | Core writing-coach product (roles, documents, Feedback Engine, no-ghostwriting) |
| `in-app-notifications/` | In-app notification inbox and catalog |
| `footnote-citation-support/` | Footnotes and citation handling in the editor |
| `scanned-pdf-reconstruction/` | PDF / OCR ingest into the editor |

Terminology in these files often predates the current UI. Prefer **Department** (not Organization), **Document Type** (not Writing Type / Writing Domain), **Department Admin** (not Field Expert / Org Owner), and **Technical Admin** / System Admin (not a single wireframe “Admin”). Where a spec still uses the older names, treat the V4 notes in `wren-writing-coach/` as the mapping.
