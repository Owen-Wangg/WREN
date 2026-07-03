/**
 * Public entry point for `@wren/types` — the shared domain contract imported by
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
export * from './auth';
export * from './authorization';

import type { AuthContext } from './auth';
import type { AuthorizationDecision, CapabilityRequest } from './authorization';
import type { Expect, LacksReplacementProse } from './no-ghostwriting';
import type {
  AccessGrant,
  AccessRequestApprovalInput,
  ActivityEvent,
  Anchor,
  AssignRoleInput,
  ContentType,
  CreateAccessGrantInput,
  CustomMetadataField,
  Document,
  Draft,
  FeedbackItem,
  GrantScope,
  Organization,
  Override,
  OverrideBounds,
  RevokeRoleInput,
  Segment,
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  TopicDeletionImpact,
  UserSearchInput,
  UserSearchResult,
  UserSummary,
  WritingType,
  WritingTypeDeletionImpact,
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
type _GuardOrganization = Expect<LacksReplacementProse<Organization>>;
type _GuardContentType = Expect<LacksReplacementProse<ContentType>>;
type _GuardCustomMetadataField = Expect<LacksReplacementProse<CustomMetadataField>>;
type _GuardWritingTypeDeletionImpact = Expect<
  LacksReplacementProse<WritingTypeDeletionImpact>
>;
type _GuardTopic = Expect<LacksReplacementProse<Topic>>;
type _GuardCreateTopicInput = Expect<LacksReplacementProse<CreateTopicInput>>;
type _GuardUpdateTopicInput = Expect<LacksReplacementProse<UpdateTopicInput>>;
type _GuardTopicDeletionImpact = Expect<LacksReplacementProse<TopicDeletionImpact>>;
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
type _GuardAuthContext = Expect<LacksReplacementProse<AuthContext>>;
type _GuardAuthorizationDecision = Expect<LacksReplacementProse<AuthorizationDecision>>;
type _GuardCapabilityRequest = Expect<LacksReplacementProse<CapabilityRequest>>;
type _GuardUserSummary = Expect<LacksReplacementProse<UserSummary>>;
type _GuardUserSearchInput = Expect<LacksReplacementProse<UserSearchInput>>;
type _GuardUserSearchResult = Expect<LacksReplacementProse<UserSearchResult>>;
type _GuardAssignRoleInput = Expect<LacksReplacementProse<AssignRoleInput>>;
type _GuardRevokeRoleInput = Expect<LacksReplacementProse<RevokeRoleInput>>;
type _GuardCreateAccessGrantInput = Expect<LacksReplacementProse<CreateAccessGrantInput>>;
type _GuardAccessRequestApprovalInput = Expect<
  LacksReplacementProse<AccessRequestApprovalInput>
>;

/**
 * Aggregates the compile-time guards so they participate in type-checking even
 * under `noUnusedLocals`. Exported as a type only; it has no runtime footprint.
 */
export type NoGhostwritingGuards = [
  _GuardWritingType,
  _GuardOrganization,
  _GuardContentType,
  _GuardCustomMetadataField,
  _GuardWritingTypeDeletionImpact,
  _GuardTopic,
  _GuardCreateTopicInput,
  _GuardUpdateTopicInput,
  _GuardTopicDeletionImpact,
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
  _GuardAuthContext,
  _GuardAuthorizationDecision,
  _GuardCapabilityRequest,
  _GuardUserSummary,
  _GuardUserSearchInput,
  _GuardUserSearchResult,
  _GuardAssignRoleInput,
  _GuardRevokeRoleInput,
  _GuardCreateAccessGrantInput,
  _GuardAccessRequestApprovalInput,
];
