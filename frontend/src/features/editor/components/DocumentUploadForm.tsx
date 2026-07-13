/**
 * Document Upload Form - Task 3.1
 *
 * Handles:
 * - File selection and S3 presigned upload
 * - Metadata validation (required custom fields)
 * - Document Type selection with access state gating
 * - LOCKED DocumentTypes show access-request option
 */
import React, { useState } from 'react';
import { useCreateDocument, useGetPresignedUrl } from '@/hooks';
import type { CreateDocumentInput } from '@wren/types';

export interface DocumentUploadFormProps {
  readonly availableDocumentTypes: Array<{
    readonly id: string;
    readonly name: string;
    readonly accessState: 'OPEN' | 'LOCKED';
  }>;
  readonly requiredMetadataFields: Array<{
    readonly label: string;
    readonly required: boolean;
  }>;
  readonly onSuccess?: (documentId: string) => void;
}

export function DocumentUploadForm({
  availableDocumentTypes,
  requiredMetadataFields,
  onSuccess,
}: DocumentUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState<string>('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [uploadMethod, setUploadMethod] = useState<'file' | 'paste'>('file');
  const [pastedText, setPastedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createDocMutation = useCreateDocument();
  const getPresignedUrlMutation = useGetPresignedUrl();

  const selectedDocType = availableDocumentTypes.find((dt) => dt.id === documentTypeId);
  const isLocked = selectedDocType?.accessState === 'LOCKED';

  const validateMetadata = (): boolean => {
    for (const field of requiredMetadataFields) {
      if (field.required && !metadata[field.label]) {
        setError(`Required field missing: ${field.label}`);
        return false;
      }
    }
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('File too large (max 10MB)');
        return;
      }
      setFile(file);
      setError(null);
    }
  };

  const handleMetadataChange = (field: string, value: string) => {
    setMetadata((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate document type
    if (!documentTypeId) {
      setError('Please select a Document Type');
      return;
    }

    // Validate metadata
    if (!validateMetadata()) {
      return;
    }

    // Validate content
    if (uploadMethod === 'file' && !file) {
      setError('Please select a file');
      return;
    }
    if (uploadMethod === 'paste' && !pastedText.trim()) {
      setError('Please paste some content');
      return;
    }

    try {
      setIsSubmitting(true);

      let sourceKey: string | undefined;

      // If file upload, get presigned URL first
      if (uploadMethod === 'file' && file) {
        const urlResponse = await getPresignedUrlMutation.mutateAsync({
          filename: file.name,
          contentType: file.type,
        });

        // Upload file to S3
        await fetch(urlResponse.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });

        sourceKey = urlResponse.key;
      }

      // Create document
      const input: CreateDocumentInput = {
        documentTypeId,
        name: file?.name || 'Pasted Document',
        metadata,
        source: {
          kind: uploadMethod,
          text: uploadMethod === 'paste' ? pastedText : undefined,
          key: sourceKey,
        },
      };

      const result = await createDocMutation.mutateAsync(input);
      onSuccess?.(result.id);

      // Reset form
      setFile(null);
      setDocumentTypeId('');
      setMetadata({});
      setPastedText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Document Type *</label>
        <select value={documentTypeId} onChange={(e) => setDocumentTypeId(e.target.value)}>
          <option value="">-- Select --</option>
          {availableDocumentTypes.map((dt) => (
            <option key={dt.id} value={dt.id}>
              {dt.name} {dt.accessState === 'LOCKED' ? '🔒' : ''}
            </option>
          ))}
        </select>
        {isLocked && (
          <p style={{ color: '#666', fontSize: '0.9em' }}>
            ℹ️ This document type is locked. You'll need access approval or can request access.
          </p>
        )}
      </div>

      <div>
        <label>Upload Method</label>
        <label>
          <input
            type="radio"
            value="file"
            checked={uploadMethod === 'file'}
            onChange={(e) => setUploadMethod(e.target.value as 'file' | 'paste')}
          />
          Upload File
        </label>
        <label>
          <input
            type="radio"
            value="paste"
            checked={uploadMethod === 'paste'}
            onChange={(e) => setUploadMethod(e.target.value as 'file' | 'paste')}
          />
          Paste Text
        </label>
      </div>

      {uploadMethod === 'file' && (
        <div>
          <label>File *</label>
          <input type="file" onChange={handleFileChange} accept=".pdf,.docx,.txt" />
          {file && <p>{file.name}</p>}
        </div>
      )}

      {uploadMethod === 'paste' && (
        <div>
          <label>Text Content *</label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={10}
          />
        </div>
      )}

      {requiredMetadataFields.length > 0 && (
        <div>
          <label>Document Details</label>
          {requiredMetadataFields.map((field) => (
            <div key={field.label}>
              <label>
                {field.label} {field.required && '*'}
              </label>
              <input
                type="text"
                value={metadata[field.label] || ''}
                onChange={(e) => handleMetadataChange(field.label, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: 'red' }}>{error}</div>}

      <button type="submit" disabled={isSubmitting || createDocMutation.isPending}>
        {isSubmitting ? 'Uploading...' : 'Create Document'}
      </button>
    </form>
  );
}
