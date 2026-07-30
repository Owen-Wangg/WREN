import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import {
  useDocumentTypes,
  useOrganizations,
} from '@/features/dashboard/useDashboard';
import { createDocument, getPresignedUrl } from '@/features/dashboard/dashboardApi';
import { generateFeedback } from '@/features/editor/anchoredFeedbackApi';
import {
  DocxClientParseError,
  docxBytesToTiptapContent,
} from '@/features/editor/docxContentMapper';
import { apiClient, ApiError } from '@/services';
import { stripAiMarksFromTipTapContent, asTipTapDoc } from '@wren/types';
import type { JSONContent } from '@tiptap/react';

const DOCX_PARSE_FALLBACK_MESSAGE =
  'Couldn’t preserve Word formatting for this file. Plain text from the server will be used — fonts, colors, alignment, and images may be missing. Prefer a simpler .docx or re-upload.';

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

      // Parse DOCX client-side for rich TipTap. PDFs use server LiteParse (1C).
      let initialContent: JSONContent | undefined;
      let docxParseWarning: string | undefined;
      const name = referenceFile.name.toLowerCase();
      if (name.endsWith('.docx')) {
        try {
          const bytes = new Uint8Array(await referenceFile.arrayBuffer());
          initialContent = await docxBytesToTiptapContent(bytes);
        } catch (error) {
          // Non-fatal: server plain-text ingest remains the fallback — surface clearly.
          docxParseWarning =
            error instanceof DocxClientParseError
              ? error.message
              : DOCX_PARSE_FALLBACK_MESSAGE;
        }
      }

      const cleaned = initialContent
        ? asTipTapDoc(stripAiMarksFromTipTapContent(initialContent))
        : undefined;

      const doc = await createDocument(apiClient, {
        documentTypeId: selectedDocumentType,
        name: documentName.trim(),
        source: { kind: 'file', key },
        ...(cleaned ? { content: cleaned } : {}),
      });

      const ingestQueued = doc.ingestStatus === 'queued';
      // Feedback needs draft text — wait until PDF ingest completes in the editor.
      if (!ingestQueued) {
        void generateFeedback(apiClient, doc.id).catch(() => {
          // Non-fatal: student can manually trigger from the editor if this fails.
        });
      }

      return {
        doc,
        org,
        docType,
        initialContent: cleaned as JSONContent | undefined,
        docxParseWarning,
        ingestQueued,
      };
    },
    onSuccess: ({ doc, org, docType, initialContent, docxParseWarning, ingestQueued }) => {
      navigate(`/dashboard/document/${doc.id}`, {
        state: {
          organizationName: org?.name,
          contentType: docType?.name,
          documentName: doc.name,
          feedbackQueued: !ingestQueued,
          ingestQueued,
          ...(initialContent ? { initialContent } : {}),
          ...(docxParseWarning ? { docxParseWarning } : {}),
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
              {organizations
                .filter((org) => org.name !== 'Test Department')
                .map((org) => (
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
            <p className="text-caption text-text-muted leading-relaxed">
              <strong>Prefer .docx</strong> when formatting matters — fonts, colors,
              highlights, alignment, images, headings, lists, and tables survive
              import/export far better than PDF spatial guesswork. PDF is supported
              for convenience (including many scanned files via OCR), but layout is
              best-effort.
            </p>
            {referenceFile?.name.toLowerCase().endsWith('.pdf') && (
              <p className="text-caption text-signal-caution leading-relaxed" role="status">
                PDF selected — expect approximate formatting. For a closer match to
                the original layout, upload the Word (.docx) source instead.
              </p>
            )}
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
