/**
 * Render tests for `<WritingTypeSelector>` (task 19.1).
 *
 * **Validates: Requirements 4.2, 4.6, 6.8, 28.2**
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WritingTypeSelector } from './WritingTypeSelector';

import type { ResolvedWritingType } from '../writingTypeAccess';

import type { WritingType } from '../dashboardTypes';

function makeWritingType(overrides: Partial<WritingType> = {}): WritingType {
  return {
    id: 'wt-1',
    organizationId: 'org-1',
    name: 'Legal Memo',
    accessState: 'OPEN',
    sizeLimitWords: null,
    ...overrides,
  };
}

const openType: ResolvedWritingType = {
  writingType: makeWritingType({ id: 'wt-open', name: 'Open Memo', accessState: 'OPEN' }),
  effectiveAccessState: 'OPEN',
  status: 'open',
  selectable: true,
};

const lockedType: ResolvedWritingType = {
  writingType: makeWritingType({ id: 'wt-locked', name: 'Locked Brief', accessState: 'LOCKED' }),
  effectiveAccessState: 'LOCKED',
  status: 'locked',
  selectable: false,
};

describe('WritingTypeSelector', () => {
  it('lets the writer self-select an OPEN writing type to start a document', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <WritingTypeSelector
        resolvedWritingTypes={[openType]}
        onSelect={onSelect}
        onRequestAccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Open Memo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start a document' }));
    expect(onSelect).toHaveBeenCalledWith(openType.writingType);
  });

  it('offers a Request access action for a LOCKED writing type instead of blocking it (Requirement 4.6)', async () => {
    const onRequestAccess = vi.fn();
    const user = userEvent.setup();
    render(
      <WritingTypeSelector
        resolvedWritingTypes={[lockedType]}
        onSelect={vi.fn()}
        onRequestAccess={onRequestAccess}
      />,
    );

    // A LOCKED type has NO "Start a document" affordance...
    expect(
      screen.queryByRole('button', { name: 'Start a document' }),
    ).not.toBeInTheDocument();
    // ...but always offers a way to request access.
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(onRequestAccess).toHaveBeenCalledWith(lockedType.writingType);
  });

  it('shows a disabled "Access requested" state once a request has been made', () => {
    render(
      <WritingTypeSelector
        resolvedWritingTypes={[lockedType]}
        onSelect={vi.fn()}
        onRequestAccess={vi.fn()}
        requestedWritingTypeIds={['wt-locked']}
      />,
    );

    const button = screen.getByRole('button', { name: 'Access requested' });
    expect(button).toBeDisabled();
  });

  it('renders an empty-state message when no writing types are available', () => {
    render(
      <WritingTypeSelector
        resolvedWritingTypes={[]}
        onSelect={vi.fn()}
        onRequestAccess={vi.fn()}
      />,
    );

    expect(
      screen.getByText('No writing types are available to you yet.'),
    ).toBeInTheDocument();
  });
});
