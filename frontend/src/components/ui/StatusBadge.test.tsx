import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the text-equivalent label for "Still Drafting"', () => {
    render(<StatusBadge status="Still Drafting" />);
    expect(screen.getByText('Still Drafting')).toBeInTheDocument();
  });

  it('renders the text-equivalent label for "Polishing"', () => {
    render(<StatusBadge status="Polishing" />);
    expect(screen.getByText('Polishing')).toBeInTheDocument();
  });

  it('never relies on color/icon alone — the label text is always present in the DOM', () => {
    render(<StatusBadge status="Polishing" />);
    // The badge's entire accessible content is the label; nothing is conveyed
    // by color/icon that isn't also present as text (accessibility baseline §8).
    const badge = screen.getByText('Polishing');
    expect(badge.textContent?.trim()).toBe('Polishing');
  });
});
