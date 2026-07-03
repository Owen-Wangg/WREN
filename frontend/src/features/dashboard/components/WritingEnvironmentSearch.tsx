/**
 * `<WritingEnvironmentSearch>` — the "My Documents" search input (frontend
 * steering §4 dashboard screen; task 19.1). Controlled: it owns no filtering
 * logic itself, it just drives the `search` term the dashboard feeds to
 * {@link filterDocuments} (which matches over name + Topic).
 */
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
        className="text-bodySmall font-sans font-medium text-text-secondary"
      >
        Search documents
      </label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder="Search by name or topic"
        className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
