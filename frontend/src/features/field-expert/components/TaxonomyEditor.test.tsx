/**
 * Render/behavior tests for `<TaxonomyEditor>` (task 19.2).
 *
 * **Validates: Requirements 24.1**
 *
 * Covers add, rename (label-only, id preserved), and remove (with confirm).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TaxonomyEditor } from './TaxonomyEditor';

import type { ErrorCategory } from '../fieldExpertSchemas';

const categories: ErrorCategory[] = [
  { id: 'cat-clarity', writingTypeId: 'wt-1', label: 'Unclear Writing', order: 0 },
  { id: 'cat-summary', writingTypeId: 'wt-1', label: 'Inaccurate Summary', order: 1 },
];

describe('TaxonomyEditor', () => {
  it('lists the existing categories', () => {
    render(
      <TaxonomyEditor
        categories={categories}
        onAdd={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('Unclear Writing')).toBeInTheDocument();
    expect(screen.getByText('Inaccurate Summary')).toBeInTheDocument();
  });

  it('adds a category with the entered label', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <TaxonomyEditor
        categories={categories}
        onAdd={onAdd}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await user.type(
      screen.getByLabelText('Add a category'),
      'Incorrect Style',
    );
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(onAdd).toHaveBeenCalledWith({ label: 'Incorrect Style' });
  });

  it('renames a category by label only, preserving its id (Requirement 24.1)', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(
      <TaxonomyEditor
        categories={categories}
        onAdd={vi.fn()}
        onRename={onRename}
        onRemove={vi.fn()}
      />,
    );

    // Enter rename mode for the first category.
    await user.click(screen.getAllByRole('button', { name: 'Rename' })[0]);

    const input = screen.getByLabelText('Rename Unclear Writing');
    await user.clear(input);
    await user.type(input, 'Clarity of Writing');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Rename is a label-only update against the SAME id — never delete+recreate.
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('cat-clarity', {
      label: 'Clarity of Writing',
    });
  });

  it('requires a confirm step before removing a category', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <TaxonomyEditor
        categories={categories}
        onAdd={vi.fn()}
        onRename={vi.fn()}
        onRemove={onRemove}
      />,
    );

    // First click reveals the confirm affordance without removing anything.
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(onRemove).toHaveBeenCalledWith('cat-clarity');
  });
});
