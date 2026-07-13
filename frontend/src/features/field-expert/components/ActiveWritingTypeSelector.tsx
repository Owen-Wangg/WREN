/**
 * `<ActiveWritingTypeSelector>` — Active-Writing-Type selection for the Field
 * Expert console (task 19.2; Requirement 23.4).
 *
 * A Field Expert may be assigned several Writing Types (across organizations).
 * Selecting the active one scopes the whole configuration surface — taxonomy,
 * prompt, reference materials, and analytics all follow the active id. This is
 * a presentational, controlled `<select>`; the connected {@link FieldExpertConsole}
 * owns the active-id state and the per-type queries.
 */
import type { WritingType } from '@wren/types';

export interface ActiveWritingTypeSelectorProps {
  readonly writingTypes: readonly WritingType[];
  /** The currently active Writing Type id (scopes the surface). */
  readonly activeWritingTypeId: string | undefined;
  readonly onChange: (writingTypeId: string) => void;
}

export function ActiveWritingTypeSelector({
  writingTypes,
  activeWritingTypeId,
  onChange,
}: ActiveWritingTypeSelectorProps) {
  if (writingTypes.length === 0) {
    return (
      <p className="text-bodySmall text-text-secondary">
        You aren't assigned to any writing types yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-xs">
      <label
        htmlFor="field-expert-active-writing-type"
        className="text-bodySmall font-sans font-medium text-text-secondary"
      >
        Active writing type
      </label>
      <select
        id="field-expert-active-writing-type"
        value={activeWritingTypeId ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
      >
        {writingTypes.map((writingType) => (
          <option key={writingType.id} value={writingType.id}>
            {writingType.name}
          </option>
        ))}
      </select>
      <p className="text-caption text-text-muted">
        Configuration below applies only to the selected writing type.
      </p>
    </div>
  );
}
