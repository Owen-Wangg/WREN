/**
 * `<TaxonomyEditor>` — the error-taxonomy editor for a Writing Type (task 19.2;
 * Requirement 24.1).
 *
 * Lists the active Writing Type's error categories and supports add, rename,
 * and remove. Categories are data with stable ids: a **rename edits the label
 * only** and calls `onRename(categoryId, { label })` against the existing id —
 * it never removes and recreates — so Feedback-Item linkage by id is preserved
 * (Requirement 24.1). Removal is a two-step inline confirm (no silent delete).
 *
 * Presentational + local UI state only (which row is being edited / confirmed);
 * the connected {@link FieldExpertConsole} owns the mutations and cache
 * invalidation. The add form uses React Hook Form + Zod (`addCategorySchema`).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { addCategorySchema } from '../fieldExpertSchemas';

import type {
  AddCategoryValues,
  ErrorCategory,
  RenameCategoryValues,
} from '../fieldExpertSchemas';

export interface TaxonomyEditorProps {
  readonly categories: readonly ErrorCategory[];
  readonly onAdd: (values: AddCategoryValues) => void;
  /** Rename is label-only; the id is passed through unchanged (Requirement 24.1). */
  readonly onRename: (categoryId: string, values: RenameCategoryValues) => void;
  readonly onRemove: (categoryId: string) => void;
  readonly isAdding?: boolean;
}

export function TaxonomyEditor({
  categories,
  onAdd,
  onRename,
  onRemove,
  isAdding = false,
}: TaxonomyEditorProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddCategoryValues>({
    resolver: zodResolver(addCategorySchema),
    defaultValues: { label: '' },
  });

  const submitAdd = handleSubmit((values) => {
    onAdd(values);
    reset({ label: '' });
  });

  return (
    <section
      aria-labelledby="taxonomy-editor-heading"
      className="flex flex-col gap-md"
    >
      <h3
        id="taxonomy-editor-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Error taxonomy
      </h3>

      {categories.length === 0 ? (
        <p className="text-bodySmall text-text-secondary">
          No categories yet. Add the first one below.
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {categories.map((category) => (
            <TaxonomyRow
              key={category.id}
              category={category}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

      <form className="flex flex-col gap-xs" noValidate onSubmit={submitAdd}>
        <label
          htmlFor="taxonomy-add-label"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Add a category
        </label>
        <div className="flex items-start gap-sm">
          <div className="flex flex-1 flex-col gap-xs">
            <input
              id="taxonomy-add-label"
              type="text"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
              {...register('label')}
            />
            {errors.label && (
              <p role="alert" className="text-caption text-signal-critical">
                {errors.label.message}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={isAdding}
            className="rounded-md bg-text-primary px-md py-sm text-bodySmall font-sans font-medium text-text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAdding ? 'Adding…' : 'Add category'}
          </button>
        </div>
      </form>
    </section>
  );
}

interface TaxonomyRowProps {
  readonly category: ErrorCategory;
  readonly onRename: (categoryId: string, values: RenameCategoryValues) => void;
  readonly onRemove: (categoryId: string) => void;
}

function TaxonomyRow({ category, onRename, onRemove }: TaxonomyRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [draftLabel, setDraftLabel] = useState(category.label);

  const saveRename = () => {
    const label = draftLabel.trim();
    if (label.length === 0) {
      return;
    }
    // Label-only update against the existing id (Requirement 24.1).
    onRename(category.id, { label });
    setIsEditing(false);
  };

  const cancelRename = () => {
    setDraftLabel(category.label);
    setIsEditing(false);
  };

  return (
    <li className="flex items-center justify-between gap-sm rounded-md border border-border-subtle bg-surface-primary px-md py-sm">
      {isEditing ? (
        <div className="flex flex-1 items-center gap-sm">
          <label
            htmlFor={`taxonomy-rename-${category.id}`}
            className="sr-only"
          >
            Rename {category.label}
          </label>
          <input
            id={`taxonomy-rename-${category.id}`}
            type="text"
            value={draftLabel}
            onChange={(event) => setDraftLabel(event.target.value)}
            className="flex-1 rounded-md border border-border-strong bg-surface-primary px-md py-xs text-body text-text-primary"
          />
          <button
            type="button"
            onClick={saveRename}
            className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelRename}
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span className="text-body font-sans text-text-primary">
            {category.label}
          </span>
          <div className="flex items-center gap-sm">
            {isConfirmingRemove ? (
              <>
                <span className="text-caption text-text-muted">Remove?</span>
                <button
                  type="button"
                  onClick={() => onRemove(category.id)}
                  className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-signal-critical"
                >
                  Confirm remove
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingRemove(false)}
                  className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingRemove(true)}
                  className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}
