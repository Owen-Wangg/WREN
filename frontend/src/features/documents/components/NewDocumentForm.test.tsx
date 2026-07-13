/**
 * Render/behavior tests for `<NewDocumentForm>` (task 18.6).
 *
 * **Validates: Requirements 6.6, 6.7**
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NewDocumentForm } from './NewDocumentForm';

import type { WritingType } from '@wren/types';

const writingTypes: WritingType[] = [
  {
    id: 'wt-legal-memo',
    organizationId: 'org-1',
    name: 'Legal Memo',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
];

describe('NewDocumentForm', () => {
  it('renders the Document Type select, the "Writing Topic" field, and NOT "Location Reference"', () => {
    render(<NewDocumentForm writingTypes={writingTypes} onActivate={vi.fn()} />);

    expect(
      screen.getByLabelText('Document Type', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Writing Topic', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Location Reference/i)).not.toBeInTheDocument();
  });

  it('keeps Activate Editor disabled while the required "Writing Topic" field is empty', () => {
    render(<NewDocumentForm writingTypes={writingTypes} onActivate={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Activate Editor' }),
    ).toBeDisabled();
  });

  it('enables Activate Editor once all required metadata fields have values', async () => {
    const user = userEvent.setup();
    render(<NewDocumentForm writingTypes={writingTypes} onActivate={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Activate Editor' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Writing Topic', { exact: false }), 'Tort');

    expect(button).toBeEnabled();
  });

  it('keeps Activate Editor disabled for whitespace-only required field values', async () => {
    const user = userEvent.setup();
    render(<NewDocumentForm writingTypes={writingTypes} onActivate={vi.fn()} />);

    await user.type(screen.getByLabelText('Writing Topic', { exact: false }), '   ');

    expect(screen.getByRole('button', { name: 'Activate Editor' })).toBeDisabled();
  });

  it('calls onActivate with the current form values, including the reference tier, once enabled', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<NewDocumentForm writingTypes={writingTypes} onActivate={onActivate} />);

    await user.type(screen.getByLabelText('Document Name', { exact: false }), 'My Memo');
    await user.selectOptions(
      screen.getByLabelText('Document Type', { exact: false }),
      'wt-legal-memo',
    );
    await user.type(screen.getByLabelText('Writing Topic', { exact: false }), 'Tort');
    await user.click(screen.getByRole('button', { name: 'Activate Editor' }));

    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        writingTypeId: 'wt-legal-memo',
        name: 'My Memo',
        metadata: { 'Writing Topic': 'Tort' },
        referenceMaterialTier: 'org-wide',
      }),
    );
  });

  it('supports a differently-configured required field generically (scales beyond "Writing Topic")', async () => {
    const user = userEvent.setup();
    render(
      <NewDocumentForm
        writingTypes={writingTypes}
        metadataFields={[
          { key: 'Case Name', label: 'Case Name', required: true },
          { key: 'Optional Note', label: 'Optional Note', required: false },
        ]}
        onActivate={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Activate Editor' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Optional Note', { exact: false }), 'not required');
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Case Name', { exact: false }), 'R v Doe');
    expect(button).toBeEnabled();
  });
});
