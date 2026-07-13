/**
 * Render tests for `<FeedbackHelpfulnessPrompt>` (task 18.3).
 *
 * **Validates: Requirements 16.1, 16.4**
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FeedbackHelpfulnessPrompt } from './FeedbackHelpfulnessPrompt';

import * as debriefApi from '../debriefApi';

import type { ReactNode } from 'react';

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe('FeedbackHelpfulnessPrompt', () => {
  it('captures a Yes rating and calls the mock recordFeedbackHelpfulness API', async () => {
    const spy = vi.spyOn(debriefApi, 'recordFeedbackHelpfulness');
    const user = userEvent.setup();
    renderWithQueryClient(
      <FeedbackHelpfulnessPrompt environmentId="doc-1" draftId="draft-1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        environmentId: 'doc-1',
        draftId: 'draft-1',
        helpful: true,
        comment: undefined,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Thanks for letting us know.',
    );
  });

  it('captures a No rating with an optional comment', async () => {
    const spy = vi.spyOn(debriefApi, 'recordFeedbackHelpfulness');
    const user = userEvent.setup();
    renderWithQueryClient(
      <FeedbackHelpfulnessPrompt environmentId="doc-1" draftId="draft-1" />,
    );

    await user.click(screen.getByRole('button', { name: 'No' }));
    await user.type(
      screen.getByLabelText('Optional comment'),
      'Too vague for my paragraph.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        helpful: false,
        comment: 'Too vague for my paragraph.',
      }),
    );
  });

  it('disables Submit until a Yes/No choice is made', () => {
    renderWithQueryClient(
      <FeedbackHelpfulnessPrompt environmentId="doc-1" draftId="draft-1" />,
    );

    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });
});
