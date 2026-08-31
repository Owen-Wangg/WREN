import { z } from 'zod';

export const modelConfigSchema = z.object({
  modelIdentifier: z.string().min(1, 'Model is required'),
});

export const usageLimitsSchema = z.object({
  messageLimit: z.number().min(1),
  debriefGenerationLimit: z.number().min(1),
  documentUploadLimit: z.number().min(1),
  draftsPerDocumentLimit: z.number().min(1),
  maxUploadFileSizeBytes: z.number().int().min(1048576).max(1073741824),
  maxWordCount: z.number().int().min(100).max(100000),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type UsageLimits = z.infer<typeof usageLimitsSchema>;
