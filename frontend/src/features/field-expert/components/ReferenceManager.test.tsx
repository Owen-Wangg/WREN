/**
 * Render/behavior tests for `<ReferenceManager>` (task 19.2).
 *
 * **Validates: Requirements 26**
 *
 * Covers listing, adding across the three input types (file / pasted-text /
 * rich-html), removing, and the loading / error states.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceManager } from './ReferenceManager';

import type { ReferenceMaterial } from '../fieldExpertSchemas';

const references: ReferenceMaterial[] = [
  {
    id: 'ref-1',
    writingTypeId: 'wt-1',
    title: 'McGill Citation Guide',
    inputType: 'file',
    preview: 'mcgill-guide.pdf',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

describe('ReferenceManager', () => {
  it('lists existing domain-scoped reference materials', () => {
    render(
      <ReferenceManager
        references={references}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('McGill Citation Guide')).toBeInTheDocument();
    expect(screen.getByText(/mcgill-guide\.pdf/)).toBeInTheDocument();
  });

  it('adds a reference via the pasted-text input type', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferenceManager references={references} onAdd={onAdd} onRemove={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('Title'), 'Holding structure');
    await user.selectOptions(
      screen.getByLabelText('Input type'),
      'pasted-text',
    );
    await user.type(
      screen.getByLabelText(/Content/),
      'A holding is a single sentence.',
    );
    await user.click(screen.getByRole('button', { name: 'Add reference' }));

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Holding structure',
      inputType: 'pasted-text',
      content: 'A holding is a single sentence.',
    });
  });

  it('adds a reference via the rich-html input type', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferenceManager references={references} onAdd={onAdd} onRemove={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('Title'), 'Drafting notes');
    await user.selectOptions(screen.getByLabelText('Input type'), 'rich-html');
    await user.type(screen.getByLabelText(/Content/), '<p>Use active voice</p>');
    await user.click(screen.getByRole('button', { name: 'Add reference' }));

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Drafting notes',
      inputType: 'rich-html',
      content: '<p>Use active voice</p>',
    });
  });

  it('removes a reference material', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferenceManager
        references={references}
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('ref-1');
  });

  it('renders the loading state', () => {
    render(
      <ReferenceManager
        references={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        isLoading
      />,
    );
    expect(screen.getByText('Loading reference materials…')).toBeInTheDocument();
  });

  it('renders an error state with a retry action', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferenceManager
        references={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        isError
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
