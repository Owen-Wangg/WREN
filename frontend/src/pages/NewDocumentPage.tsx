import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useContentTypes, useOrganizations, useWritingTypes } from '@/features/dashboard/useDashboard';

export function NewDocumentPage() {
  const navigate = useNavigate();

  const organizationsQuery = useOrganizations();
  const organizations = organizationsQuery.data ?? [];

  const writingTypesQuery = useWritingTypes();
  const allWritingTypes = writingTypesQuery.data ?? [];

  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedWritingDomains, setSelectedWritingDomains] = useState<string[]>([]);
  const [selectedDocumentType, setSelectedDocumentType] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [referenceFile, setReferenceFile] = useState<File | undefined>(undefined);

  const primaryWritingDomain = selectedWritingDomains[0] ?? '';
  const contentTypesQuery = useContentTypes(primaryWritingDomain);
  const contentTypes = contentTypesQuery.data ?? [];

  const writingDomainsForDept = allWritingTypes.filter(
    (wt) => wt.organizationId === selectedDepartment,
  );

  const canActivate = selectedDepartment && selectedWritingDomains.length > 0 && selectedDocumentType && documentName.trim();

  const handleDepartmentChange = (value: string) => {
    setSelectedDepartment(value);
    setSelectedWritingDomains([]);
    setSelectedDocumentType('');
  };

  const handleAddWritingDomain = (value: string) => {
    if (value && !selectedWritingDomains.includes(value)) {
      setSelectedWritingDomains((prev) => [...prev, value]);
      if (selectedWritingDomains.length === 0) {
        setSelectedDocumentType('');
      }
    }
  };

  const handleRemoveWritingDomain = (id: string) => {
    setSelectedWritingDomains((prev) => {
      const next = prev.filter((d) => d !== id);
      if (id === primaryWritingDomain) {
        setSelectedDocumentType('');
      }
      return next;
    });
  };

  const handleActivate = () => {
    const org = organizations.find((o) => o.id === selectedDepartment);
    const writingDomainNames = selectedWritingDomains
      .map((id) => allWritingTypes.find((wt) => wt.id === id)?.name)
      .filter(Boolean);
    const docType = contentTypes.find((ct) => ct.id === selectedDocumentType);
    navigate('/dashboard/document/new-draft', {
      state: {
        writingType: org?.name,
        writingDomain: writingDomainNames.join(', '),
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

        {/* Step 2: Writing Domain (multi-select badges + dropdown) */}
        {selectedDepartment && (
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="writing-domain-select"
              className="text-body font-sans font-semibold text-text-primary"
            >
              Writing Domain
            </label>
            {writingTypesQuery.isLoading && (
              <p role="status" className="text-bodySmall text-text-secondary">
                Loading writing domains…
              </p>
            )}
            {!writingTypesQuery.isLoading && writingDomainsForDept.length === 0 && (
              <p className="text-bodySmall text-text-secondary">
                No writing domains available for this department.
              </p>
            )}
            {!writingTypesQuery.isLoading && writingDomainsForDept.length > 0 && (
              <>
                {selectedWritingDomains.length > 0 && (
                  <div className="flex flex-wrap gap-sm">
                    {selectedWritingDomains.map((id) => {
                      const domain = allWritingTypes.find((wt) => wt.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-xs rounded-full bg-accent-primary/10 px-md py-xs text-bodySmall font-sans font-medium text-accent-primary"
                        >
                          {domain?.name ?? id}
                          <button
                            type="button"
                            aria-label={`Remove ${domain?.name ?? id}`}
                            onClick={() => handleRemoveWritingDomain(id)}
                            className="ml-xs inline-flex h-4 w-4 items-center justify-center rounded-full text-accent-primary/70 hover:bg-accent-primary/20 hover:text-accent-primary"
                          >
                            &times;
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <select
                  id="writing-domain-select"
                  value=""
                  className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
                  onChange={(e) => handleAddWritingDomain(e.target.value)}
                >
                  <option value="" disabled>
                    {selectedWritingDomains.length > 0 ? 'Add another domain…' : 'Select writing domain'}
                  </option>
                  {writingDomainsForDept
                    .filter((wt) => !selectedWritingDomains.includes(wt.id))
                    .map((wt) => (
                      <option key={wt.id} value={wt.id}>
                        {wt.name}
                      </option>
                    ))}
                </select>
              </>
            )}
          </div>
        )}

        {/* Step 3: Document Type (Content Type dropdown) */}
        {primaryWritingDomain && (
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
                No document types available for this domain.
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

        {/* Step 4: Document Name */}
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

        {/* Step 5: File Upload */}
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
