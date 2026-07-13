/**
 * `AskWrenService` — the abstraction the Ask WREN panel talks to instead of a
 * concrete API call (task 18.6; design.md "Ask WREN Session State"; the panel
 * is "Socratic-only, draft-anchored, and subject to the SAME no-ghostwriting
 * guardrail as the main feedback engine").
 *
 * Mirrors the `AuthService`/`DraftService` pattern: a real contract plus a
 * {@link MockAskWrenService} used until the DynamoDB-backed
 * `${StackPrefix}-ConversationHistory` session store converges.
 */
import type { WrenChatMessage } from './askWrenTypes';

export interface SendAskWrenMessageInput {
  readonly documentId: string;
  readonly draftId: string;
  readonly text: string;
}

export interface AskWrenService {
  /** Sends a message scoped to a specific draft and returns WREN's Socratic reply. */
  sendMessage(input: SendAskWrenMessageInput): Promise<WrenChatMessage>;
}
