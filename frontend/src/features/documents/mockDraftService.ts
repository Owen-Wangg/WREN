/**
 * In-memory {@link DraftService} implementation (task 18.6; Requirement 8.1).
 *
 * Each `createDraft` call appends a NEW `Draft` with a monotonically
 * increasing `versionNumber` and a fresh `id` — it never overwrites or
 * mutates a previously returned Draft object, matching the immutable-Draft
 * invariant modelled in `@wren/types` (`Draft` has no update path, only
 * creation).
 */
import type { Draft } from '@wren/types';

import type { CreateDraftInput, DraftService } from './draftService';

export class MockDraftService implements DraftService {
  private readonly draftsByDocument = new Map<string, Draft[]>();
  private nextDraftSequence = 1;

  async createDraft({ documentId, file }: CreateDraftInput): Promise<Draft> {
    const existing = this.draftsByDocument.get(documentId) ?? [];
    const versionNumber = existing.length + 1;
    const wordCount = await estimateWordCount(file);

    const newDraft: Draft = {
      id: `draft-${this.nextDraftSequence++}`,
      documentId,
      versionNumber,
      s3Key: `mock/${documentId}/${file.name}`,
      segments: [],
      wordCount,
      createdAt: new Date().toISOString(),
    };

    // Append-only: prior Draft objects in `existing` are untouched.
    this.draftsByDocument.set(documentId, [...existing, newDraft]);
    return newDraft;
  }

  async getDrafts(documentId: string): Promise<readonly Draft[]> {
    return this.draftsByDocument.get(documentId) ?? [];
  }
}

async function estimateWordCount(file: File): Promise<number> {
  try {
    const text = await file.text();
    return text.split(/\s+/).filter(Boolean).length;
  } catch {
    return 0;
  }
}
