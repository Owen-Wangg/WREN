/**
 * `<WritingEnvironmentSearch>` — the "My Documents" search input (frontend
 * steering §4 dashboard screen; task 19.1). Controlled: it owns no filtering
 * logic itself, it just drives the `search` term the dashboard feeds to
 * {@link filterDocuments} (which matches over name + Topic).
 */
import { Search } from 'lucide-react';

export interface WritingEnvironmentSearchProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly id?: string;
}

export function WritingEnvironmentSearch({
  value,
  onChange,
  id = 'writing-environment-search',
}: WritingEnvironmentSearchProps) {
  return (
    <div className="flex flex-col gap-xs">
      <label
        htmlFor={id}
        className="sr-only"
      >
        Search documents
      </label>
      <div className="relative w-full">
        <Search
          size={20}
          aria-hidden="true"
          className="absolute left-lg top-1/2 -translate-y-1/2 text-border-strong/40"
        />
        <input
          id={id}
          type="search"
          value={value}
          placeholder="Search Writing Environments"
          className="w-full rounded-lg border border-border-strong/40 bg-surface-primary py-sm pl-[48px] pr-lg text-heading3 text-text-primary placeholder:text-text-primary/40"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
