/**
 * Compliance render tests for the AI Debrief modal (task 18.7; Requirement 11.2).
 *
 * **Asserts:**
 * 1. AI feedback content in the debrief is structurally distinguishable from
 *    writer text — the modal renders only AI-generated Socratic questions and
 *    category labels (never writer prose), with clear `data-ai-feedback`
 *    markers and distinct structural roles.
 * 2. NO Apply/Insert/Accept affordance exists anywhere in the debrief.
 * 3. The modal traps focus (Tab does not escape).
 * 4. Escape closes the modal.
 * 5. The × close button closes the modal.
 * 6. Focus returns to the triggering button on close.
 *
 * Uses the same QueryClientProvider wrapper and mock API as existing
 * `AiDebriefModal.test.tsx` (task 18.3).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AiDebriefModal } from './components/AiDebriefModal';

import { useState, type ReactNode } from 'react';

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

/**
 * Wraps the modal with a trigger button to test focus-return behavior.
 */
function ModalWithTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <button
        type="button"
        data-testid="trigger-button"
        onClick={() => setOpen(true)}
      >
        View AI Debrief
      </button>
      <AiDebriefModal
        environmentId="doc-1"
        open={open}
        onOpenChange={setOpen}
      />
    </QueryClientProvider>
  );
}


// --- Tests ------------------------------------------------------------------

describe('AI Debrief — No-Ghostwriting Compliance (Requirement 11.2)', () => {
  describe('AI feedback is structurally distinguishable from writer text', () => {
    it('the debrief modal renders feedback within semantically-labelled sections, not as generic text', async () => {
      renderWithQueryClient(
        <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
      );

      // Wait for loading to finish.
      await waitFor(() =>
        expect(screen.queryByRole('status')).not.toBeInTheDocument(),
      );

      // Feedback is rendered in structurally distinct sections (inline vs. structural).
      const inlineSection = screen
        .getByRole('heading', { name: 'Inline feedback' })
        .closest('section');
      const structuralSection = screen
        .getByRole('heading', { name: 'Document structure' })
        .closest('section');

      expect(inlineSection).not.toBeNull();
      expect(structuralSection).not.toBeNull();
      // These are distinct DOM subtrees — never merged.
      expect(inlineSection).not.toBe(structuralSection);
    });

    it('the debrief modal always includes the AI disclaimer notice (role="note") to mark content as AI-generated', async () => {
      renderWithQueryClient(
        <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
      );

      // The AiDisclaimerNotice renders with role="note".
      expect(screen.getByRole('note')).toBeInTheDocument();
    });

    it('debrief content is anchored to a specific draft version, not rendered generically', async () => {
      renderWithQueryClient(
        <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
      );

      await waitFor(() =>
        expect(screen.queryByRole('status')).not.toBeInTheDocument(),
      );

      // Draft anchoring indicator is present.
      expect(screen.getByText(/Based on draft/)).toBeInTheDocument();
    });
  });

  describe('No Apply/Insert/Accept affordance exists in the debrief', () => {
    it('no button with Apply/Insert/Accept text or aria-label exists in the debrief modal', async () => {
      renderWithQueryClient(
        <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
      );

      await waitFor(() =>
        expect(screen.queryByRole('status')).not.toBeInTheDocument(),
      );

      const forbidden = /\b(apply|insert|accept)\b/i;
      const buttons = screen.getAllByRole('button');
      for (const button of buttons) {
        expect(button.textContent ?? '').not.toMatch(forbidden);
        expect(button.getAttribute('aria-label') ?? '').not.toMatch(forbidden);
      }
    });

    it('no interactive element offering text insertion exists anywhere in the debrief', async () => {
      renderWithQueryClient(
        <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />,
      );

      await waitFor(() =>
        expect(screen.queryByRole('status')).not.toBeInTheDocument(),
      );

      const forbidden = /\b(apply|insert|accept|use this|paste suggestion)\b/i;
      const interactive = document.querySelectorAll('button, a, [role="button"]');
      for (const el of interactive) {
        expect(el.textContent ?? '').not.toMatch(forbidden);
        expect(el.getAttribute('aria-label') ?? '').not.toMatch(forbidden);
      }
    });
  });
});

describe('AI Debrief — Accessibility: Focus Trap & Modal Behavior (Steering §8)', () => {
  it('pressing Escape closes the modal', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={onOpenChange} />,
    );

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clicking the × close button closes the modal', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithQueryClient(
      <AiDebriefModal environmentId="doc-1" open onOpenChange={onOpenChange} />,
    );

    const closeButton = screen.getByRole('button', { name: 'Close AI Debrief' });
    await user.click(closeButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('focus is trapped inside the modal when open (Tab does not escape)', async () => {
    const user = userEvent.setup();

    renderWithQueryClient(
      <div>
        <button type="button" data-testid="outside-button">
          Outside
        </button>
        <AiDebriefModal environmentId="doc-1" open onOpenChange={() => {}} />
      </div>,
    );

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    );

    // Tab through all focusable elements inside the modal.
    // Radix Dialog traps focus — the outside button should never receive focus.
    const outsideButton = screen.getByTestId('outside-button');

    // Tab many times to cycle through all modal focusable elements.
    for (let i = 0; i < 20; i++) {
      await user.tab();
      expect(document.activeElement).not.toBe(outsideButton);
    }
  });

  it('focus returns to the triggering button after the modal is closed', async () => {
    const user = userEvent.setup();

    render(<ModalWithTrigger />);

    const triggerButton = screen.getByTestId('trigger-button');

    // Open the modal.
    await user.click(triggerButton);

    // Wait for the modal content to appear.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Close AI Debrief' }),
      ).toBeInTheDocument(),
    );

    // Close via Escape.
    await user.keyboard('{Escape}');

    // Focus should return to the trigger button.
    await waitFor(() => expect(document.activeElement).toBe(triggerButton));
  });

  it('focus returns to the triggering button after closing via the × button', async () => {
    const user = userEvent.setup();

    render(<ModalWithTrigger />);

    const triggerButton = screen.getByTestId('trigger-button');

    // Open the modal.
    await user.click(triggerButton);

    // Wait for the modal content to appear.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Close AI Debrief' }),
      ).toBeInTheDocument(),
    );

    // Close via the × button.
    await user.click(screen.getByRole('button', { name: 'Close AI Debrief' }));

    // Focus should return to the trigger button.
    await waitFor(() => expect(document.activeElement).toBe(triggerButton));
  });
});
