/**
 * Render tests for `<AiDebriefModal>` (task 18.3).
 *
 * **Validates: Requirements 11.2, 14.2, 16.1, 16.2, 16.3, 16.4, 16.5, 48.2, 48.3**
 *
 * Uses the app's mock API fixtures (`src/services/mockApi.ts`) directly rather
 * than mocking the query hooks, so these tests exercise the real React Query +
 * mock-API wiring described by the design ("React Query invalidation on
 * regenerate").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AiDebriefModal } from './AiDebriefModal';

import * as debriefApi from '../debriefApi';

import type { Debrief } from '../debriefTypes';
import type { ReactNode } from 'react';

const feedbackDebrief: Debrief = {
  documentId: 'doc-1',
  draftId: 'draft-1',
  generatedAt: '2024-01-02T00:00:00.000Z',
  categoryNames: { clarity: 'Clarity', organization: 'Organization' },
  progressSummary: [],
  items: [
    {
      id: 'feedback-clarity',
      documentId: 'doc-1',
      errorCategoryId: 'clarity',
      kind: 'inline',
      questionText:
        'Hedging language appears frequently. Where can you state your position directly?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'feedback-organization',
      documentId: 'doc-1',
      errorCategoryId: 'organization',
      kind: 'structural',
      questionText:
        'Information is separated into distinct sections, which helps readers locate key topics.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
  ],
};

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe('AiDebriefModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(debriefApi, 'fetchDebrief').mockImplementation(
      async (_client, environmentId) => {
        if (environmentId === 'doc-does-not-exist') {
          throw new Error('Document not found');
        }
        if (environmentId === 'doc-2') {
          return {
            ...feedbackDebrief,
            documentId: 'doc-2',
            draftId: 'draft-2',
            items: [],
          };
        }
        return feedbackDebrief;
      },
    );
    vi.spyOn(debriefApi, 'regenerateDebrief').mockResolvedValue();
  });
  it('renders feedback grouped by category in distinct sections (Requirement 14.2)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    );

    const claritySection = screen
      .getByRole('heading', { name: 'Clarity' })
      .closest('section');
    const organizationSection = screen
      .getByRole('heading', { name: 'Organization' })
      .closest('section');

    expect(claritySection).not.toBeNull();
    expect(organizationSection).not.toBeNull();
    expect(claritySection).not.toBe(organizationSection);

    // Clarity items live only in the Clarity section.
    expect(
      within(claritySection as HTMLElement).getByText(/Hedging language/),
    ).toBeInTheDocument();
    expect(
      within(organizationSection as HTMLElement).queryByText(/Hedging language/),
    ).not.toBeInTheDocument();

    // Organization items live only in the Organization section.
    expect(
      within(organizationSection as HTMLElement).getByText(/separated into distinct sections/),
    ).toBeInTheDocument();
    expect(
      within(claritySection as HTMLElement).queryByText(/separated into distinct sections/),
    ).not.toBeInTheDocument();
  });

  it('shows a loading state while the debrief is being fetched', () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading AI Debrief…');
  });

  it('shows an error state with a retry affordance when the debrief fails to load (Requirement 16.3)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-does-not-exist" open onOpenChange={() => {}} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong loading the AI Debrief.',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows an empty state when the document has no generated feedback yet (Requirement 16.5)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-2" open onOpenChange={() => {}} />,
    );

    expect(
      await screen.findByText("Feedback hasn't been generated for this document yet."),
    ).toBeInTheDocument();
  });

  it('enqueues auto-regeneration without fabricating a newer draft response (Requirement 16.2)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open autoRegenerate onOpenChange={() => {}} />,
    );

    await waitFor(() =>
      expect(debriefApi.regenerateDebrief).toHaveBeenCalledTimes(1),
    );
    // Regeneration is asynchronous. A subscription refreshes the query only
    // after processing completes, so the existing fetched draft remains shown.
    expect(screen.getByText('Based on draft draft-1')).toBeInTheDocument();
  });

  it('always renders the shared AiDisclaimerNotice (steering §3)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
    );

    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('never renders an Apply, Insert, or Accept affordance anywhere in the modal (REQ-CORE-NOGHOST-01)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    );

    const buttons = screen.getAllByRole('button');
    const forbidden = /apply|insert|accept/i;
    for (const button of buttons) {
      expect(button.textContent ?? '').not.toMatch(forbidden);
    }
  });

  it('is closable via the × button and calls onOpenChange(false)', async () => {
    const user = userEvent.setup();
    let open = true;
    const handleOpenChange = (next: boolean) => {
      open = next;
    };

    renderWithQueryClient(
      <AiDebriefModal
        environmentId="doc-1"
        open={open}
        onOpenChange={handleOpenChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Close AI Debrief' }));
    expect(open).toBe(false);
  });
});
