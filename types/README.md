# `@leon/types` — shared domain contract

Single source of truth for the platform's core domain types and runtime
validation schemas (frontend steering §7: shared types live in `/types`). Both
the backend (CDK / Node Lambdas) and the frontend import these so the API
contract is defined exactly once.

## What's here

TypeScript types + [Zod](https://zod.dev) schemas for the core entities:

| Entity | Notes |
| --- | --- |
| `Role` | `User` \| `Field Expert` \| `Org Owner` \| `Admin` (Requirement 1.1) |
| `AccessState` / `WritingTypeAccessState` | `OPEN` \| `LOCKED` (+ `INHERIT` for a Writing Type) |
| `WritingType` | Configurable, self-selectable writing type (design's "Writing Domain") |
| `Document`, `DocumentStatus` | Owned by a global User, scoped to a Writing Type |
| `Draft`, `Segment` | Immutable, monotonically versioned drafts |
| `FeedbackItem`, `FeedbackKind` | Socratic feedback — **never** carries replacement prose |
| `ResolutionStatus` | `resolved` \| `partially_resolved` \| `still_unresolved` \| `removed` \| `unchanged` |
| `Anchor`, `AnchorState` | Ties feedback to a text span, re-mapped across drafts |
| `AccessGrant`, `GrantScope` | Associates a global User with a LOCKED scope |
| `Override`, `OverrideBounds` | Temporary, Writing-Type-scoped usage override |
| `ActivityEvent` | Actor–Verb–Object event, independent of document content |

## No-ghostwriting invariant (REQ-CORE-NOGHOST-01)

No DTO may carry a `replacementProse` field. This is enforced two ways:

1. **Compile time (structural).** Every DTO type is checked in `index.ts` with
   `Expect<LacksReplacementProse<T>>`. If any type gains a `replacementProse`
   key, `tsc --noEmit` fails the build.
2. **Runtime (boundary).** Every schema is declared `.strict()`, so an inbound
   object carrying `replacementProse` (or any unknown key) is rejected by
   `parse`. `assertNoReplacementProse` / `containsReplacementProse` provide a
   deep guard for loosely-typed payloads (e.g. JSON columns).

## Consuming it

`types` is an npm workspace, so it resolves by name:

```ts
import { feedbackItemSchema, type FeedbackItem } from '@leon/types';

const item: FeedbackItem = feedbackItemSchema.parse(await response.json());
```

A consuming package (`cdk/`, `frontend/`) adds `"@leon/types": "*"` to its
dependencies (or joins the root workspaces) to pull it in. Validate API
responses at the boundary with the exported schemas.

## Verify

```bash
npm run -w @leon/types typecheck   # tsc --noEmit
npx jest types/src                 # unit + property tests
```
