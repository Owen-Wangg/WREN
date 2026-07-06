/**
 * `<MetadataFieldsInput>` — renders the configurable custom-metadata fields for
 * the new-document form (task 18.6; Requirements 6.6, 6.7). Generic over
 * `MetadataFieldConfig[]` so it scales to any number of Org-Owner-configured
 * fields; the default config renders only the seeded "Writing Topic" field
 * (product decision 1 — no "Location Reference").
 */
import type { MetadataFieldConfig } from '../documentMetadataConfig';

export interface MetadataFieldsInputProps {
  readonly fields: readonly MetadataFieldConfig[];
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (key: string, value: string) => void;
}

export function MetadataFieldsInput({
  fields,
  values,
  onChange,
}: MetadataFieldsInputProps) {
  return (
    <div className="flex flex-col gap-md">
      {fields.map((field) => {
        const inputId = `document-metadata-${field.key.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <div key={field.key} className="flex flex-col gap-sm">
            <label
              htmlFor={inputId}
              className="text-body font-sans font-semibold text-text-secondary"
            >
              {field.label}
              {field.required && <span aria-hidden="true"> *</span>}
            </label>
            <input
              id={inputId}
              type="text"
              required={field.required}
              aria-required={field.required}
              value={values[field.key] ?? ''}
              className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
