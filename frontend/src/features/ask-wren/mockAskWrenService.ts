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
  private readonly sessions = new Map<string, WrenChatMessage[]>();

  private sessionKey(documentId: string, draftId: string): string {
    return `${documentId}#${draftId}`;
  }

  async getMessages(documentId: string, draftId: string): Promise<readonly WrenChatMessage[]> {
    return this.sessions.get(this.sessionKey(documentId, draftId)) ?? [];
  }

  async sendMessage({
    documentId,
    draftId,
    text,
  }: SendAskWrenMessageInput): Promise<WrenChatMessage> {
    const key = this.sessionKey(documentId, draftId);
    const prior = this.sessions.get(key) ?? [];
    const userMessage: WrenChatMessage = {
      id: `user-message-${nextMessageSequence++}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    const reply: WrenChatMessage = {
      id: `wren-message-${nextMessageSequence++}`,
      role: 'wren',
      text: buildSocraticReply(text),
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(key, [...prior, userMessage, reply]);
    return reply;
  }
}

function buildSocraticReply(userText: string): string {
  const trimmed = userText.trim().toLowerCase();
  if (!trimmed) {
    return 'What part of your draft would you like to talk through?';
  }
  if (trimmed.includes('intro') || trimmed.includes('fix')) {
    return 'What makes you say the intro needs fixing? Is it the hook, the thesis statement, or how you frame the topic?';
  }
  if (trimmed.includes('formal') || trimmed.includes('tone')) {
    return 'Where in this draft does the tone feel off to you, and what would a more appropriate register need to accomplish?';
  }
  if (trimmed.includes('run-on') || trimmed.includes('sentence')) {
    return 'Which sentence feels overloaded, and what is the single main point you want that sentence to carry?';
  }
  if (trimmed.includes('clear') || trimmed.includes('structure') || trimmed.includes('confusing')) {
    return 'What is the core claim in the unclear section, and where should that claim appear for a reader encountering it cold?';
  }
  return 'What would help you most right now — locating where the issue is, or figuring out what question that section should answer?';
}
