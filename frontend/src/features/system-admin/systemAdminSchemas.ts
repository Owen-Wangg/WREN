import { z } from 'zod';

export const modelConfigSchema = z.object({
  modelIdentifier: z.string().min(1, 'Model is required'),
});

export const usageLimitsSchema = z.object({
  messageLimit: z.number().min(1),
  debriefGenerationLimit: z.number().min(1),
  documentUploadLimit: z.number().min(1),
  draftsPerDocumentLimit: z.number().min(1),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type UsageLimits = z.infer<typeof usageLimitsSchema>;
