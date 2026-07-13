/**
 * `useReUploadDraft` — the re-upload flow's hook (task 18.6; Requirement 8.1).
 *
 * Given an existing Document id, accepts a new file and calls
 * {@link DraftService.createDraft}. Exposes the full accumulated Draft history
 * (`drafts`) so callers/tests can assert a re-upload appended a NEW Draft
 * rather than replacing the previous current Draft.
 */
import { useCallback, useState } from 'react';

import type { DraftService } from './draftService';

import type { Draft } from '@wren/types';

export interface UseReUploadDraftResult {
  readonly drafts: readonly Draft[];
  readonly isUploading: boolean;
  readonly error: string | null;
  readonly reUpload: (file: File) => Promise<Draft>;
}

export function useReUploadDraft(
  documentId: string,
  draftService: DraftService,
): UseReUploadDraftResult {
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setError(null);
      try {
        const newDraft = await draftService.createDraft({ documentId, file });
        // Append-only: never replaces/mutates a previously stored Draft.
        setDrafts((prev) => [...prev, newDraft]);
        return newDraft;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Something went wrong re-uploading this document. Please try again.',
        );
        throw cause;
      } finally {
        setIsUploading(false);
      }
    },
    [documentId, draftService],
  );

  return { drafts, isUploading, error, reUpload };
}
