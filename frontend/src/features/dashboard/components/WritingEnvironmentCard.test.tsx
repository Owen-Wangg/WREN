/**
 * Render tests for `<WritingEnvironmentCard>` (task 19.1).
 *
 * **Validates: Requirements 4.2, 1.2**
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WritingEnvironmentCard } from './WritingEnvironmentCard';

import type { Document } from '@wren/types';

const baseDocument: Document = {
  id: 'doc-1',
  ownerUserId: 'user-1',
  documentTypeId: 'wt-legal-memo',
  contentTypeId: 'ct-1',
  name: 'Charter s.8 analysis',
  metadata: { 'Writing Topic': 'Search and seizure' },
  status: 'Still Drafting',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('WritingEnvironmentCard', () => {
  it('renders the document Topic, name, and Status via the shared StatusBadge', () => {
    render(<WritingEnvironmentCard document={baseDocument} />);

    expect(screen.getByText('Search and seizure')).toBeInTheDocument();
    expect(screen.getByText('Charter s.8 analysis')).toBeInTheDocument();
    // The status label comes from the shared statusColorMap-backed StatusBadge.
    expect(screen.getByText('Still Drafting')).toBeInTheDocument();
  });

  it('renders the Polishing status through the StatusBadge enum lookup (never free text)', () => {
    render(
      <WritingEnvironmentCard
        document={{ ...baseDocument, status: 'Polishing' }}
      />,
    );

    expect(screen.getByText('Polishing')).toBeInTheDocument();
  });

  it('omits the Topic label when the document has no "Writing Topic" metadata', () => {
    render(
      <WritingEnvironmentCard document={{ ...baseDocument, metadata: {} }} />,
    );

    expect(screen.queryByText('Search and seizure')).not.toBeInTheDocument();
    expect(screen.getByText('Charter s.8 analysis')).toBeInTheDocument();
  });

  it('activates the title as a control and calls onOpen when supplied', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<WritingEnvironmentCard document={baseDocument} onOpen={onOpen} />);

    await user.click(
      screen.getByRole('button', { name: 'Open Charter s.8 analysis' }),
    );
    expect(onOpen).toHaveBeenCalledWith(baseDocument);
  });
});
