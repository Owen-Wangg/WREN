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
    const anchorId = getHighlightAnchorForQuestion(text);
    return {
      id: `wren-message-${nextMessageSequence++}`,
      role: 'wren',
      text: buildSocraticReply(text),
      createdAt: new Date().toISOString(),
      highlightAnchorId: anchorId,
    };
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
    return "Look at this sentence: \"Expenses happened too from medications and travel although receipts are not all available currently.\" Notice the passive voice and wordy phrasing — \"happened\", \"although receipts are not\" — these create distance from the reader. What would it sound like if you made it more direct and active?";
  }
  if (trimmed.includes('run-on') || trimmed.includes('sentence')) {
    return 'Here\'s an example: \"Person 1 had pain and suffering and also had to miss work. It is believed maybe around $25,000 could be awarded but also maybe more because injuries can sometimes last long periods.\" Notice how each \"and\" adds another idea? Try breaking it into separate sentences — each one should focus on one main point.';
  }
  if (trimmed.includes('clear') || trimmed.includes('structure') || trimmed.includes('confusing')) {
    return "Look at: \"This is about a negligence claim maybe and happened in Kelowna sometime in January.\" What's the core fact here? Lead with that — then layer in the context. Can you reorder it so the main point lands first?";
  }
  return 'What would help you most — understanding where the issue is, or brainstorming how to rewrite it?';
}

function getHighlightAnchorForQuestion(userText: string): string | undefined {
  const lower = userText.toLowerCase();
  // Map student questions to relevant anchors to highlight
  if (lower.includes('formal') || lower.includes('tone')) {
    return 'anchor-tone-2'; // Highlights the formal phrasing example
  }
  if (lower.includes('run-on') || lower.includes('sentence')) {
    return 'anchor-grammar-2'; // Highlights the run-on sentence example
  }
  if (lower.includes('clear') || lower.includes('structure')) {
    return 'anchor-clarity-2'; // Highlights the complex sentence example
  }
  return undefined;
}
