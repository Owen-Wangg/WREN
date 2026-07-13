/**
 * `<ReferenceManager>` — the domain-scoped reference material manager (task
 * 19.2; Requirement 26).
 *
 * Lists the active Writing Type's tier-2 reference materials and supports
 * adding a new one via the three input types (file / pasted-text / rich-html —
 * `addReferenceSchema`) and removing existing ones. Add uses React Hook Form +
 * Zod; the connected {@link FieldExpertConsole} owns the mutation and only
 * persists on a successful, fully-validated submit (no partial persistence).
 *
 * Loading and error states are rendered here so the manager degrades gracefully
 * while the domain-scoped list is fetched.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { addReferenceSchema } from '../fieldExpertSchemas';

import type {
  AddReferenceValues,
  ReferenceInputType,
  ReferenceMaterial,
} from '../fieldExpertSchemas';

const INPUT_TYPE_OPTIONS: readonly {
  value: ReferenceInputType;
  label: string;
}[] = [
  { value: 'file', label: 'File' },
  { value: 'pasted-text', label: 'Pasted text' },
  { value: 'rich-html', label: 'Rich HTML' },
];

const INPUT_TYPE_LABEL: Record<ReferenceInputType, string> = {
  file: 'File',
  'pasted-text': 'Pasted text',
  'rich-html': 'Rich HTML',
};

export interface ReferenceManagerProps {
  readonly references: readonly ReferenceMaterial[];
  readonly onAdd: (values: AddReferenceValues) => void;
  readonly onRemove: (referenceId: string) => void;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly onRetry?: () => void;
  readonly isAdding?: boolean;
}

export function ReferenceManager({
  references,
  onAdd,
  onRemove,
  isLoading = false,
  isError = false,
  onRetry,
  isAdding = false,
}: ReferenceManagerProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddReferenceValues>({
    resolver: zodResolver(addReferenceSchema),
    defaultValues: { title: '', inputType: 'file', content: '' },
  });

  const submitAdd = handleSubmit((values) => {
    onAdd(values);
    reset({ title: '', inputType: 'file', content: '' });
  });

  return (
    <section
      aria-labelledby="reference-manager-heading"
      className="flex flex-col gap-md"
    >
      <h3
        id="reference-manager-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Reference materials
      </h3>

      {isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading reference materials…
        </p>
      )}

      {isError && (
        <div role="alert" className="flex flex-col gap-sm">
          <p className="text-bodySmall text-signal-critical">
            Something went wrong loading reference materials.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {references.length === 0 ? (
            <p className="text-bodySmall text-text-secondary">
              No reference materials yet. Add one below.
            </p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {references.map((reference) => (
                <li
                  key={reference.id}
                  className="flex items-center justify-between gap-sm rounded-md border border-border-subtle bg-surface-primary px-md py-sm"
                >
                  <div className="flex flex-col gap-xs">
                    <span className="text-body font-sans font-medium text-text-primary">
                      {reference.title}
                    </span>
                    <span className="text-caption text-text-muted">
                      {INPUT_TYPE_LABEL[reference.inputType]} · {reference.preview}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(reference.id)}
                    className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <form className="flex flex-col gap-md" noValidate onSubmit={submitAdd}>
        <div className="flex flex-col gap-xs">
          <label
            htmlFor="reference-add-title"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Title
          </label>
          <input
            id="reference-add-title"
            type="text"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('title')}
          />
          {errors.title && (
            <p role="alert" className="text-caption text-signal-critical">
              {errors.title.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xs">
          <label
            htmlFor="reference-add-input-type"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Input type
          </label>
          <select
            id="reference-add-input-type"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('inputType')}
          >
            {INPUT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-xs">
          <label
            htmlFor="reference-add-content"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Content (file name, pasted text, or HTML)
          </label>
          <textarea
            id="reference-add-content"
            rows={3}
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('content')}
          />
          {errors.content && (
            <p role="alert" className="text-caption text-signal-critical">
              {errors.content.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isAdding}
          className="self-start rounded-md bg-text-primary px-md py-sm text-bodySmall font-sans font-medium text-text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isAdding ? 'Adding…' : 'Add reference'}
        </button>
      </form>
    </section>
  );
}
