/**
 * `<DocumentTypeSelect>` — the Document Type (Writing Type) select for the
 * new-document form (frontend steering §4 known screens; task 18.6).
 *
 * Writing Type is configurable, self-selectable data (tasks.md product
 * decision 2) — this component never hardcodes a domain enumeration, it just
 * renders whatever `writingTypes` the caller supplies.
 */
import type { WritingType } from '@wren/types';

export interface DocumentTypeSelectProps {
  readonly id: string;
  readonly writingTypes: readonly WritingType[];
  readonly value: string;
  readonly onChange: (writingTypeId: string) => void;
  readonly error?: string;
}

export function DocumentTypeSelect({
  id,
  writingTypes,
  value,
  onChange,
  error,
}: DocumentTypeSelectProps) {
  return (
    <div className="flex flex-col gap-sm">
      <label
        htmlFor={id}
        className="text-body font-sans font-semibold text-text-secondary"
      >
        Document Type
      </label>
      <select
        id={id}
        value={value}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Select a document type
        </option>
        {writingTypes.map((writingType) => (
          <option key={writingType.id} value={writingType.id}>
            {writingType.name}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-bodySmall text-signal-critical">
          {error}
        </p>
      )}
    </div>
  );
}
