/**
 * `<ReUploadControl>` — re-upload affordance for an existing Document (frontend
 * steering §4 "Re-Upload"; task 18.6; Requirement 8.1). Wraps
 * `useReUploadDraft`: selecting a new file creates a NEW Draft, it never
 * overwrites the Document's existing Draft(s).
 */
import { useState } from 'react';

import { useReUploadDraft } from '../useReUploadDraft';

import type { DraftService } from '../draftService';

import type { Draft } from '@wren/types';

export interface ReUploadControlProps {
  readonly documentId: string;
  readonly draftService: DraftService;
  /** Called with the newly created Draft after a successful re-upload. */
  readonly onDraftCreated?: (draft: Draft) => void;
}

export function ReUploadControl({
  documentId,
  draftService,
  onDraftCreated,
}: ReUploadControlProps) {
  const { isUploading, error, reUpload } = useReUploadDraft(
    documentId,
    draftService,
  );
  const inputId = `re-upload-${documentId}`;
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setSelectedFileName(file.name);
    const draft = await reUpload(file).catch(() => undefined);
    if (draft) {
      onDraftCreated?.(draft);
    }
  };

  return (
    <div className="flex flex-col gap-xs">
      <label
        htmlFor={inputId}
        className="text-bodySmall font-sans font-medium text-text-secondary"
      >
        Re-Upload Document
      </label>
      <input
        id={inputId}
        type="file"
        disabled={isUploading}
        className="text-bodySmall text-text-primary"
        onChange={(event) => handleFileSelected(event.target.files?.[0])}
      />
      {selectedFileName && !error && (
        <p className="text-bodySmall text-text-muted">
          {isUploading ? 'Uploading…' : `Uploaded: ${selectedFileName}`}
        </p>
      )}
      {error && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          {error}
        </p>
      )}
    </div>
  );
}
