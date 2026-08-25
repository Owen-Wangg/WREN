# `@wren/types` — shared domain contract

Single source of truth for the platform's core domain types and runtime
validation schemas. Backend Node Lambdas and the frontend import these so the
API contract is defined once.

## What's here

TypeScript types plus [Zod](https://zod.dev) schemas. Names below match the
current V4 model (`Student` / `DepartmentAdmin` / `TechnicalAdmin`,
`department`, `document_type`).

| Entity | Notes |
| --- | --- |
| `Role` | `Student` \| `DepartmentAdmin` \| `TechnicalAdmin` |
| `AccessState` | `OPEN` \| `LOCKED` |
| `Department` | Grouping of document types and Department Admins; not a user tenant |
| `DocumentType` | Configurable catalog entry students select when creating a document |
| `Document`, `DocumentStatus` | Owned by a user, scoped to a document type |
| `Draft`, `Segment` | Immutable, monotonically versioned drafts |
| `FeedbackItem`, `FeedbackKind` | Socratic feedback — **never** carries replacement prose |
| `ResolutionStatus` | `resolved` \| `partially_resolved` \| `still_unresolved` \| `removed` \| `unchanged` |
| `Anchor`, `AnchorState` | Ties feedback to a text span, remapped across drafts |
| `AccessGrant`, `GrantScope` | Associates a user with a LOCKED scope |
| `Override`, `OverrideBounds` | Temporary usage override |
| `ActivityEvent` | Actor–verb–object event, independent of document content |

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
import { feedbackItemSchema, type FeedbackItem } from '@wren/types';

const item: FeedbackItem = feedbackItemSchema.parse(await response.json());
```

A consuming package (`cdk/`, `frontend/`) adds `"@wren/types": "*"` to its
dependencies (or joins the root workspaces) to pull it in. Validate API
responses at the boundary with the exported schemas.

## Verify

```bash
npm run -w @wren/types typecheck   # tsc --noEmit
npx jest types/src                 # unit + property tests
```
