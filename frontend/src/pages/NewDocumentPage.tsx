import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useContentTypes, useOrganizations } from '@/features/dashboard/useDashboard';

export function NewDocumentPage() {
  const navigate = useNavigate();

  const organizationsQuery = useOrganizations();
  const organizations = organizationsQuery.data ?? [];

  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedDocumentType, setSelectedDocumentType] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [referenceFile, setReferenceFile] = useState<File | undefined>(undefined);

  const contentTypesQuery = useContentTypes(selectedDepartment);
  const contentTypes = contentTypesQuery.data ?? [];

  const canActivate = selectedDepartment && selectedDocumentType && documentName.trim();

  const handleDepartmentChange = (value: string) => {
    setSelectedDepartment(value);
    setSelectedDocumentType('');
  };

  const handleActivate = () => {
    const org = organizations.find((o) => o.id === selectedDepartment);
    const docType = contentTypes.find((ct) => ct.id === selectedDocumentType);
    navigate('/dashboard/document/new-draft', {
      state: {
        organizationName: org?.name,
        contentType: docType?.name,
        documentName,
        referenceFile: referenceFile?.name,
      },
    });
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
        {/* Step 1: Writing Type (Department) */}
        <div className="flex flex-col gap-sm">
          <label
            htmlFor="department-select"
            className="text-body font-sans font-semibold text-text-primary"
          >
            Writing Type
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

        {/* Step 2: Document Type (Content Type dropdown) */}
        {selectedDepartment && (
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="document-type-select"
              className="text-body font-sans font-semibold text-text-primary"
            >
              Document Type
            </label>
            {contentTypesQuery.isLoading && (
              <p role="status" className="text-bodySmall text-text-secondary">
                Loading document types…
              </p>
            )}
            {!contentTypesQuery.isLoading && contentTypes.length === 0 && (
              <p className="text-bodySmall text-text-secondary">
                No document types available for this department.
              </p>
            )}
            {!contentTypesQuery.isLoading && contentTypes.length > 0 && (
              <select
                id="document-type-select"
                value={selectedDocumentType}
                className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
                onChange={(e) => setSelectedDocumentType(e.target.value)}
              >
                <option value="" disabled>
                  Select document type
                </option>
                {contentTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name}
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

        <button
          type="submit"
          disabled={!canActivate}
          className="w-full rounded-lg bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          Activate Editor
        </button>
      </form>
    </div>
  );
}
