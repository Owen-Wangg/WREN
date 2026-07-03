/**
 * In-memory {@link AskWrenService} implementation (task 18.6).
 *
 * Replies are always phrased as a Socratic question and never contain
 * rewrite/apply language — matching the same no-ghostwriting guardrail the
 * main Feedback Engine enforces (Requirement 11.1). This mock exists to build
 * and test the panel until the real backend session store converges; it is
 * not a substitute for the guardrail enforcement that belongs server-side.
 */
import type { AskWrenService, SendAskWrenMessageInput } from './askWrenService';

import type { WrenChatMessage } from './askWrenTypes';

let nextMessageSequence = 1;

export class MockAskWrenService implements AskWrenService {
  async sendMessage({ text }: SendAskWrenMessageInput): Promise<WrenChatMessage> {
    return {
      id: `wren-message-${nextMessageSequence++}`,
      role: 'wren',
      text: buildSocraticReply(text),
      createdAt: new Date().toISOString(),
    };
  }
}

function buildSocraticReply(userText: string): string {
  const trimmed = userText.trim();
  if (!trimmed) {
    return 'What part of your draft would you like to talk through?';
  }
  return `What makes you say "${trimmed}"? What would you look for in your draft to check that?`;
}
