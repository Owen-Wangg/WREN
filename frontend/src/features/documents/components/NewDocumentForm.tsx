/**
 * `NewDocumentForm` — the new-document creation form (frontend steering §4
 * known screens; task 18.6; Requirements 6.6, 6.7, 8.1).
 *
 * Composes `DocumentTypeSelect`, `MetadataFieldsInput` (configurable custom
 * metadata; illustrative "Writing Topic" field only — product decision 1),
 * and `ReferenceFileUpload` (two-tier reference model). The "Activate Editor"
 * button stays `disabled` until every configured required metadata field has
 * a value (Requirement 6.7); the check is generic over `fields` so it scales
 * to N configured fields without touching this component.
 *
 * `onActivate` stubs the eventual transition into `<DocumentEditor>` (task
 * 18.1) — page/route composition that mounts the editor is out of scope here.
 */
import { useState } from 'react';

import { DocumentTypeSelect } from './DocumentTypeSelect';
import { MetadataFieldsInput } from './MetadataFieldsInput';
import { ReferenceFileUpload } from './ReferenceFileUpload';

import {
  areRequiredFieldsFilled,
  DEFAULT_METADATA_FIELDS,
  type MetadataFieldConfig,
} from '../documentMetadataConfig';
import type { ReferenceMaterialTier } from '../documentSchemas';

import type { WritingType } from '@wren/types';

export interface NewDocumentFormValues {
  readonly writingTypeId: string;
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly referenceFile: File | undefined;
  readonly referenceMaterialTier: ReferenceMaterialTier;
}

export interface NewDocumentFormProps {
  readonly writingTypes: readonly WritingType[];
  /** Configured custom metadata fields; defaults to the seeded "Writing Topic" field only. */
  readonly metadataFields?: readonly MetadataFieldConfig[];
  /** Called with the current form values when "Activate Editor" is pressed. */
  readonly onActivate: (values: NewDocumentFormValues) => void;
}

export function NewDocumentForm({
  writingTypes,
  metadataFields = DEFAULT_METADATA_FIELDS,
  onActivate,
}: NewDocumentFormProps) {
  const [writingTypeId, setWritingTypeId] = useState('');
  const [name, setName] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [referenceFile, setReferenceFile] = useState<File | undefined>(undefined);
  const [referenceMaterialTier, setReferenceMaterialTier] =
    useState<ReferenceMaterialTier>('org-wide');

  const requiredFieldsFilled = areRequiredFieldsFilled(metadataFields, metadata);

  const handleMetadataChange = (key: string, value: string) => {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  };

  const handleActivate = () => {
    onActivate({
      writingTypeId,
      name,
      metadata,
      referenceFile,
      referenceMaterialTier,
    });
  };

  return (
    <form
      className="flex w-full max-w-lg flex-col gap-lg"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        handleActivate();
      }}
    >
      <div className="flex flex-col gap-xs">
        <label
          htmlFor="new-document-name"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Document Name
        </label>
        <input
          id="new-document-name"
          type="text"
          value={name}
          className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <DocumentTypeSelect
        id="new-document-type"
        writingTypes={writingTypes}
        value={writingTypeId}
        onChange={setWritingTypeId}
      />

      <MetadataFieldsInput
        fields={metadataFields}
        values={metadata}
        onChange={handleMetadataChange}
      />

      <ReferenceFileUpload
        id="new-document-reference-file"
        file={referenceFile}
        tier={referenceMaterialTier}
        onFileChange={setReferenceFile}
        onTierChange={setReferenceMaterialTier}
      />

      <button
        type="submit"
        disabled={!requiredFieldsFilled}
        className="rounded-md bg-text-primary px-md py-sm text-body font-sans font-medium text-text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        Activate Editor
      </button>
    </form>
  );
}
