import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AI_DISCLAIMER_DEFAULT_MESSAGE,
  AiDisclaimerNotice,
} from './AiDisclaimerNotice';

describe('AiDisclaimerNotice', () => {
  it('renders the default disclaimer copy as a note region', () => {
    render(<AiDisclaimerNotice />);

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(AI_DISCLAIMER_DEFAULT_MESSAGE);
  });

  it('renders a custom message when provided, so call sites never inline the copy themselves', () => {
    render(<AiDisclaimerNotice message="Custom disclaimer copy" />);

    expect(screen.getByRole('note')).toHaveTextContent(
      'Custom disclaimer copy',
    );
  });

  it('uses the calm notice tokens, not an alert/warning role (steering §9)', () => {
    render(<AiDisclaimerNotice />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('note').className).toContain('bg-notice-surface');
  });
});
