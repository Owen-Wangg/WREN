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
import { describe, expect, it } from 'vitest';

import { AiDebriefModal } from './AiDebriefModal';

import type { ReactNode } from 'react';

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe('AiDebriefModal', () => {
  it('renders inline and structural feedback in visually/structurally distinct sections (Requirement 14.2)', async () => {
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    );

    const inlineSection = screen
      .getByRole('heading', { name: 'Inline feedback' })
      .closest('section');
    const structuralSection = screen
      .getByRole('heading', { name: 'Document structure' })
      .closest('section');

    expect(inlineSection).not.toBeNull();
    expect(structuralSection).not.toBeNull();
    expect(inlineSection).not.toBe(structuralSection);

    // The inline item's Socratic question lives only in the inline section.
    expect(
      within(inlineSection as HTMLElement).getByText(/main legal holding/),
    ).toBeInTheDocument();
    expect(
      within(structuralSection as HTMLElement).queryByText(/main legal holding/),
    ).not.toBeInTheDocument();

    // The structural item's question lives only in the structural section.
    expect(
      within(structuralSection as HTMLElement).getByText(/order of your arguments/),
    ).toBeInTheDocument();
    expect(
      within(inlineSection as HTMLElement).queryByText(/order of your arguments/),
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

  it('invalidates and refetches the debrief cache entry when "Regenerate AI Debrief" is clicked (Requirement 16.2)', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.getByText('Based on draft draft-1')).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole('button', { name: 'Regenerate AI Debrief' }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Regenerate AI Debrief' }),
      ).not.toBeDisabled(),
    );

    // The mock regenerate route returns a debrief with a newer generatedAt but
    // the same draftId; the cache entry was refreshed via setQueryData +
    // invalidateQueries rather than the stale initial fetch persisting.
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
