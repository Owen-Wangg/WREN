/**
 * Public entry point for `@leon/types` — the shared domain contract imported by
 * the backend (CDK / Node Lambdas) and the frontend.
 *
 * In addition to re-exporting every schema and type, this module enforces the
 * no-ghostwriting invariant **structurally at compile time**: each DTO type is
 * checked with `Expect<LacksReplacementProse<T>>`. If any of these types ever
 * gains a `replacementProse` key, the corresponding guard below fails to
 * type-check and `tsc` fails the build (REQ-CORE-NOGHOST-01 / Requirements 11.1).
 */
export * from './common';
export * from './no-ghostwriting';
export * from './schemas';

import type { Expect, LacksReplacementProse } from './no-ghostwriting';
import type {
  AccessGrant,
  ActivityEvent,
  Anchor,
  Document,
  Draft,
  FeedbackItem,
  GrantScope,
  Override,
  OverrideBounds,
  Segment,
  WritingType,
} from './schemas';

/* -------------------------------------------------------------------------- */
/* Compile-time no-ghostwriting guards.                                       */
/*                                                                            */
/* Each alias instantiates Expect<LacksReplacementProse<T>>, whose constraint  */
/* `T extends true` fails to type-check if the DTO carries a `replacementProse`*/
/* key. These are type-only and erase at runtime; their sole purpose is to     */
/* break the build if the invariant is ever violated.                         */
/* -------------------------------------------------------------------------- */

type _GuardWritingType = Expect<LacksReplacementProse<WritingType>>;
type _GuardDocument = Expect<LacksReplacementProse<Document>>;
type _GuardSegment = Expect<LacksReplacementProse<Segment>>;
type _GuardDraft = Expect<LacksReplacementProse<Draft>>;
type _GuardAnchor = Expect<LacksReplacementProse<Anchor>>;
type _GuardFeedbackItem = Expect<LacksReplacementProse<FeedbackItem>>;
type _GuardGrantScope = Expect<LacksReplacementProse<GrantScope>>;
type _GuardAccessGrant = Expect<LacksReplacementProse<AccessGrant>>;
type _GuardOverrideBounds = Expect<LacksReplacementProse<OverrideBounds>>;
type _GuardOverride = Expect<LacksReplacementProse<Override>>;
type _GuardActivityEvent = Expect<LacksReplacementProse<ActivityEvent>>;

/**
 * Aggregates the compile-time guards so they participate in type-checking even
 * under `noUnusedLocals`. Exported as a type only; it has no runtime footprint.
 */
export type NoGhostwritingGuards = [
  _GuardWritingType,
  _GuardDocument,
  _GuardSegment,
  _GuardDraft,
  _GuardAnchor,
  _GuardFeedbackItem,
  _GuardGrantScope,
  _GuardAccessGrant,
  _GuardOverrideBounds,
  _GuardOverride,
  _GuardActivityEvent,
];
