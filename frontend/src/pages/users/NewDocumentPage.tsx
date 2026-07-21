import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import {
  useDocumentTypes,
  useOrganizations,
} from '@/features/dashboard/useDashboard';
import { createDocument, createDraft } from '@/features/dashboard/dashboardApi';
import { generateFeedback } from '@/features/editor/anchoredFeedbackApi';
import { docxBytesToTiptapContent } from '@/features/editor/docxContentMapper';
import { apiClient } from '@/services';

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
    documentName.trim();

  const handleDepartmentChange = (value: string) => {
    setSelectedDepartment(value);
    setSelectedDocumentType('');
  };

  const activateMutation = useMutation({
    mutationFn: async () => {
      const org = organizations.find((o) => o.id === selectedDepartment);
      const docType = documentTypes.find((dt) => dt.id === selectedDocumentType);

      const doc = await createDocument(apiClient, {
        documentTypeId: selectedDocumentType,
        name: documentName.trim(),
      });

      let tiptapContent: import('@tiptap/react').JSONContent | undefined;
      if (referenceFile) {
        const bytes = new Uint8Array(await referenceFile.arrayBuffer());
        tiptapContent = await docxBytesToTiptapContent(bytes);
        const segments = (tiptapContent.content ?? []).map((block, idx) => ({
          index: idx,
          text: (block.content ?? [])
            .filter((n) => n.type === 'text')
            .map((n) => n.text ?? '')
            .join(''),
        }));
        await createDraft(apiClient, doc.id, segments);
        // Auto-trigger feedback generation on first upload — fire and forget,
        // the editor page polls status and shows "Generating…" while it runs.
        void generateFeedback(apiClient, doc.id).catch(() => {
          // Non-fatal: student can manually trigger from the editor if this fails.
        });
      }

      return { doc, org, docType, tiptapContent };
    },
    onSuccess: ({ doc, org, docType, tiptapContent }) => {
      navigate(`/dashboard/document/${doc.id}`, {
        state: {
          organizationName: org?.name,
          contentType: docType?.name,
          documentName: doc.name,
          initialContent: tiptapContent,
        },
      });
    },
  });

  const handleActivate = () => {
    activateMutation.mutate();
  };

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

        {activateMutation.isError && (
          <p role="alert" className="text-bodySmall text-signal-critical">
            Failed to create document. Please try again.
          </p>
        )}

        <button
          type="submit"
          disabled={!canActivate || activateMutation.isPending}
          className="w-full rounded-lg bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activateMutation.isPending ? 'Creating…' : 'Activate Editor'}
        </button>
      </form>
    </div>
  );
}
