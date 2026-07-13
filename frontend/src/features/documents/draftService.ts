/**
 * `DraftService` — the abstraction the re-upload flow talks to instead of a
 * concrete API call (task 18.6; Requirement 8.1: "WHEN a User re-uploads or
 * re-submits a Document that already has at least one Draft, THE
 * Document_Service SHALL create a new Draft linked to the same Document and
 * SHALL retain all prior Drafts.").
 *
 * Mirrors the `AuthService` pattern (`features/auth/authService.ts`): a real
 * contract plus a {@link MockDraftService} implementation used until the
 * backend Document/Draft service (task 6.8) converges.
 */
import type { Draft } from '@wren/types';

export interface CreateDraftInput {
  readonly documentId: string;
  readonly file: File;
}

/** The contract the re-upload flow depends on. */
export interface DraftService {
  /** Creates a NEW Draft for `documentId` — never mutates a prior Draft. */
  createDraft(input: CreateDraftInput): Promise<Draft>;
  /** All Drafts for a Document, ordered chronologically (oldest first). */
  getDrafts(documentId: string): Promise<readonly Draft[]>;
}
