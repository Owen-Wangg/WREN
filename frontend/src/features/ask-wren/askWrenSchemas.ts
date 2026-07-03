/**
 * Validation schema for the Ask WREN message input, colocated with
 * `WrenChatPanel` (frontend steering §9).
 */
import { z } from 'zod';

export const askWrenMessageSchema = z.object({
  text: z.string().min(1, 'Enter a question before sending.'),
});
export type AskWrenMessageFormValues = z.infer<typeof askWrenMessageSchema>;
