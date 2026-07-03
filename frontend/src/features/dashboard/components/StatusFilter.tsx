/**
 * `<StatusFilter>` — the "My Documents" status filter control (frontend
 * steering §4 dashboard screen; task 19.1).
 *
 * The selectable statuses are derived from the shared `statusColorMap` keys, so
 * status stays an enum with a single source of truth (Requirement 1.2 /
 * steering §9) — adding a new `DocumentStatus` surfaces here automatically and
 * this control never hardcodes status label strings. `All` (the
 * {@link ALL_STATUSES} sentinel) disables the status filter in
 * {@link filterDocuments}.
 */
import { ALL_STATUSES, type StatusFilterValue } from '../documentFilters';

import { statusColorMap } from '@/components/ui';

import type { DocumentStatus } from '@wren/types';

const STATUS_OPTIONS = Object.keys(statusColorMap) as DocumentStatus[];

export interface StatusFilterProps {
  readonly value: StatusFilterValue;
  readonly onChange: (value: StatusFilterValue) => void;
  readonly id?: string;
}

export function StatusFilter({
  value,
  onChange,
  id = 'status-filter',
}: StatusFilterProps) {
  return (
    <div className="flex flex-col gap-xs">
      <label
        htmlFor={id}
        className="text-bodySmall font-sans font-medium text-text-secondary"
      >
        Status
      </label>
      <select
        id={id}
        value={value}
        className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
        onChange={(event) => onChange(event.target.value as StatusFilterValue)}
      >
        <option value={ALL_STATUSES}>All statuses</option>
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {statusColorMap[status].label}
          </option>
        ))}
      </select>
    </div>
  );
}
