/**
 * `<ReferenceFileUpload>` — reference-material upload for the new-document
 * form (frontend steering §4 known screens; task 18.6).
 *
 * Carries an explicit tier/scope selector so the two-tier reference material
 * model (frontend steering §3, §11) is never flattened into a single generic
 * upload field, even though the backend's org-wide-vs-writing-type-scoped
 * distinction (task 10.1) isn't wired yet. Tier 1 = org-wide, Tier 2 =
 * scoped to the selected Writing Type.
 */
import type { ReferenceMaterialTier } from '../documentSchemas';

export interface ReferenceFileUploadProps {
  readonly id: string;
  readonly file: File | undefined;
  readonly tier: ReferenceMaterialTier;
  readonly onFileChange: (file: File | undefined) => void;
  readonly onTierChange: (tier: ReferenceMaterialTier) => void;
}

export function ReferenceFileUpload({
  id,
  file,
  tier,
  onFileChange,
  onTierChange,
}: ReferenceFileUploadProps) {
  const tierSelectId = `${id}-tier`;

  return (
    <div className="flex flex-col gap-xs">
      <label
        htmlFor={id}
        className="text-bodySmall font-sans font-medium text-text-secondary"
      >
        Reference Material (optional)
      </label>
      <input
        id={id}
        type="file"
        className="text-bodySmall text-text-primary"
        onChange={(event) => onFileChange(event.target.files?.[0])}
      />
      {file && (
        <p className="text-bodySmall text-text-muted">Selected: {file.name}</p>
      )}

      <label
        htmlFor={tierSelectId}
        className="mt-xs text-bodySmall font-sans font-medium text-text-secondary"
      >
        Reference scope
      </label>
      <select
        id={tierSelectId}
        value={tier}
        className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-bodySmall text-text-primary"
        onChange={(event) =>
          onTierChange(event.target.value as ReferenceMaterialTier)
        }
      >
        <option value="org-wide">Org-wide (Tier 1)</option>
        <option value="writing-type">This document type only (Tier 2)</option>
      </select>
    </div>
  );
}
