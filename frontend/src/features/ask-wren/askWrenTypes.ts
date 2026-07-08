/**
 * Local types for the Ask WREN chat panel (task 18.6; frontend steering §4
 * "Ask WREN — slides in alongside debrief, doesn't replace it").
 *
 * Deliberately mirrors the `@wren/types` no-ghostwriting invariant: there is
 * NO `replacementProse` field anywhere here, not even informally. Ask WREN
 * answers are Socratic-only and subject to the SAME no-ghostwriting guardrail
 * as the main Feedback Engine (design.md "Ask WREN Session State"; Requirement
 * 11.1) — a `WrenChatMessage` carries only a Socratic `text` reply, never a
 * suggested rewrite.
 */

export type ChatRole = 'user' | 'wren';

export interface WrenChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
  readonly createdAt: string;
  /** Anchor ID to highlight when coach responds with a specific section reference. */
  readonly highlightAnchorId?: string;
}

/** A message scoped to one Draft version — draft anchoring (Requirement 11.1's
 * companion draft-anchoring invariant; design.md Ask WREN Session State). */
export interface WrenChatSession {
  readonly documentId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly messages: readonly WrenChatMessage[];
}
