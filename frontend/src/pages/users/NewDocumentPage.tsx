import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import {
  useDocumentTypes,
  useOrganizations,
} from '@/features/dashboard/useDashboard';
import { createDocument, getPresignedUrl } from '@/features/dashboard/dashboardApi';
import { generateFeedback } from '@/features/editor/anchoredFeedbackApi';
import { docxBytesToTiptapContent } from '@/features/editor/docxContentMapper';
import { pdfBytesToTiptapContent } from '@/features/editor/pdfContentMapper';
import { apiClient, ApiError } from '@/services';
import type { JSONContent } from '@tiptap/react';

function contentTypeForFile(file: File): string {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'message' in details) {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Failed to create document. Please try again.';
}

export function NewDocumentPage() {
  const navigate = useNavigate();

  const organizationsQuery = useOrganizations();
  const organizations = organizationsQuery.data ?? [];

  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedDocumentType, setSelectedDocumentType] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [referenceFile, setReferenceFile] = useState<File | undefined>(undefined);

  const documentTypesQuery = useDocumentTypes(selectedDepartment);
  const documentTypes = documentTypesQuery.data ?? [];

  const canActivate =
    selectedDepartment &&
    selectedDocumentType &&
    documentName.trim() &&
    referenceFile;

  const handleDepartmentChange = (value: string) => {
    setSelectedDepartment(value);
    setSelectedDocumentType('');
  };

  const activateMutation = useMutation({
    mutationFn: async () => {
      const org = organizations.find((o) => o.id === selectedDepartment);
      const docType = documentTypes.find((dt) => dt.id === selectedDocumentType);
      if (!referenceFile) {
        throw new Error('A .docx or .pdf file is required');
      }

      const { uploadUrl, key } = await getPresignedUrl(
        apiClient,
        referenceFile.name,
        contentTypeForFile(referenceFile),
      );

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: referenceFile,
        headers: { 'Content-Type': contentTypeForFile(referenceFile) },
      });
      if (!putResponse.ok) {
        throw new Error('File upload to storage failed');
      }

      const doc = await createDocument(apiClient, {
        documentTypeId: selectedDocumentType,
        name: documentName.trim(),
        source: { kind: 'file', key },
      });

      // Auto-trigger feedback — fire and forget; editor polls status.
      void generateFeedback(apiClient, doc.id).catch(() => {
        // Non-fatal: student can manually trigger from the editor if this fails.
      });

      // Parse docx client-side so the editor shows the formatted document
      // (headings, bold, paragraph breaks) rather than plain-text segments.
      let initialContent: JSONContent | undefined;
      try {
        const bytes = new Uint8Array(await referenceFile.arrayBuffer());
        const name = referenceFile.name.toLowerCase();
        if (name.endsWith('.docx')) {
          initialContent = await docxBytesToTiptapContent(bytes);
        } else if (name.endsWith('.pdf')) {
          initialContent = await pdfBytesToTiptapContent(bytes);
        }
      } catch {
        // Non-fatal: editor will fall back to plain-text segments from the API.
      }

      return { doc, org, docType, initialContent };
    },
    onSuccess: ({ doc, org, docType, initialContent }) => {
      navigate(`/dashboard/document/${doc.id}`, {
        state: {
          organizationName: org?.name,
          contentType: docType?.name,
          documentName: doc.name,
          feedbackQueued: true,
          // Rich TipTap content parsed client-side (docx only).
          // Editor uses this over plain-text segments from the API.
          ...(initialContent ? { initialContent } : {}),
        },
      });
    },
  });

  const handleActivate = () => {
    activateMutation.mutate();
  };

  const errorMessage = activateMutation.isError
    ? errorMessageFromUnknown(activateMutation.error)
    : null;

  return (
    <div className="flex flex-col items-center gap-xl py-xl">
      <form
        className="flex w-full max-w-[720px] flex-col gap-xl rounded-2xl border border-border-strong/50 bg-surface-primary p-2xl shadow-md"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleActivate();
        }}
      >
        {/* Step 1: Department */}
        <div className="flex flex-col gap-sm">
          <label
            htmlFor="department-select"
            className="text-body font-sans font-semibold text-text-primary"
          >
            Department
          </label>
          {organizationsQuery.isLoading && (
            <p role="status" className="text-bodySmall text-text-secondary">
              Loading departments…
            </p>
          )}
          {organizationsQuery.isError && (
            <p role="alert" className="text-bodySmall text-signal-critical">
              Couldn't load departments.
            </p>
          )}
          {!organizationsQuery.isLoading && !organizationsQuery.isError && (
            <select
              id="department-select"
              value={selectedDepartment}
              className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
              onChange={(e) => handleDepartmentChange(e.target.value)}
            >
              <option value="" disabled>
                Select department
              </option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Step 2: Document Type */}
        {selectedDepartment && (
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="document-type-select"
              className="text-body font-sans font-semibold text-text-primary"
            >
              Document Type
            </label>
            {documentTypesQuery.isLoading && (
              <p role="status" className="text-bodySmall text-text-secondary">
                Loading document types…
              </p>
            )}
            {!documentTypesQuery.isLoading && documentTypes.length === 0 && (
              <p className="text-bodySmall text-text-secondary">
                No document types available for this department.
              </p>
            )}
            {!documentTypesQuery.isLoading && documentTypes.length > 0 && (
              <select
                id="document-type-select"
                value={selectedDocumentType}
                className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
                onChange={(e) => setSelectedDocumentType(e.target.value)}
              >
                <option value="" disabled>
                  Select document type
                </option>
                {documentTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    {dt.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Step 3: Document Name */}
        {selectedDocumentType && (
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="document-name-input"
              className="text-body font-sans font-semibold text-text-primary"
            >
              Document Name
            </label>
            <input
              id="document-name-input"
              type="text"
              value={documentName}
              placeholder="Enter document name"
              className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
              onChange={(e) => setDocumentName(e.target.value)}
            />
          </div>
        )}

        {/* Step 4: File Upload */}
        {documentName.trim() && (
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="reference-file-input"
              className="text-body font-sans font-semibold text-text-primary"
            >
              File Upload
            </label>
            <input
              id="reference-file-input"
              type="file"
              accept=".docx,.pdf"
              className="rounded-md border border-border-subtle bg-surface-muted px-lg py-sm text-bodySmall text-text-primary file:mr-md file:rounded-md file:border-0 file:bg-surface-primary file:px-md file:py-xs file:text-bodySmall file:font-sans file:text-text-secondary"
              onChange={(e) => setReferenceFile(e.target.files?.[0])}
            />
            {referenceFile && (
              <p className="text-bodySmall text-accent-primary">
                Selected: {referenceFile.name}
              </p>
            )}
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="text-bodySmall text-signal-critical">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={!canActivate || activateMutation.isPending}
          className="w-full rounded-lg bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activateMutation.isPending ? 'Uploading & creating…' : 'Activate Editor'}
        </button>
      </form>
    </div>
  );
}
