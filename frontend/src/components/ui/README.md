# Shared UI primitives

shadcn/ui (Radix-based) primitives and other shared, presentational components
live here (frontend steering §5/§9). They theme through the centralized design
tokens (`src/styles/tokens` + the mirrored `@theme` block) — never raw values.

## Compliance primitives (task 17.2)

- **`<AiDisclaimerNotice>`** — the single reusable AI-generated-feedback
  disclaimer notice (Requirement 1.2). Never copy-paste this notice's text
  inline; import the component instead so dashboard, debrief modal, and chat
  panel stay in sync. Rendered as a calm, neutral card — not a warning banner
  (steering §9).
- **`statusColorMap` / `getStatusColorEntry` / `getStatusColor`** — the single
  lookup from the extensible `DocumentStatus` enum (`Still Drafting` /
  `Polishing`, from `@wren/types`) to color tokens + a text-equivalent label.
  Adding a new status is a one-file edit here; no component should branch on
  status inline.
- **`<StatusBadge>`** — renders a `DocumentStatus` via `statusColorMap`, always
  showing the text label alongside color (accessibility baseline, steering §8).
- **`<SeverityBadge>` / `severityLevelMap`** — severity-by-color, never a
  numeric score (Requirement 18.3). Three qualitative levels
  (`positive` / `caution` / `critical`) backed by the `signal*` color tokens.
- **`<RoleGate>`** — the shared role-aware rendering primitive (steering §2,
  §11). Gates children by an explicit `allow` list of `Role` values from
  `@wren/types`; no shared component should hardcode "the current user is a
  Student." Reads the current role from `src/app/RoleContext.tsx` by default.
