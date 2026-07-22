/**
 * Live Ask WREN client — talks to GET/POST /v1/documents/{id}/ask-wren.
 */
import { z } from 'zod';

import type { HttpClient } from '@/services';

import type { AskWrenService, SendAskWrenMessageInput } from './askWrenService';
import type { WrenChatMessage } from './askWrenTypes';

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'wren']),
  text: z.string(),
  createdAt: z.string(),
  highlightAnchorId: z.string().optional(),
});

const postReplySchema = z.object({
  sessionId: z.string(),
  message: messageSchema,
});

const sessionSchema = z.object({
  sessionId: z.string(),
  documentId: z.string(),
  draftId: z.string(),
  messages: z.array(messageSchema),
});

export function askWrenPath(documentId: string): string {
  return `/v1/documents/${documentId}/ask-wren`;
}

export class ApiAskWrenService implements AskWrenService {
  constructor(private readonly client: HttpClient) {}

  async getMessages(documentId: string, draftId: string): Promise<readonly WrenChatMessage[]> {
    const path = `${askWrenPath(documentId)}?draftId=${encodeURIComponent(draftId)}`;
    const result = await this.client.request(path, {
      method: 'GET',
      schema: sessionSchema,
    });
    return result.messages;
  }

  async sendMessage(input: SendAskWrenMessageInput): Promise<WrenChatMessage> {
    const result = await this.client.request(askWrenPath(input.documentId), {
      method: 'POST',
      body: { draftId: input.draftId, text: input.text },
      schema: postReplySchema,
    });
    return result.message;
  }
}
