/**
 * Smoke tests for `<FootnotePanel>` (footnote-citation-support spec).
 *
 * Full timing (Requirement 3.2) and save/delete interaction tests are
 * covered in Task 5.4 (wave 6); this file validates basic render
 * correctness and the missing-field inline error wiring introduced in
 * Task 5.3.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FootnotePanel } from './FootnotePanel';
import type { FootnoteAttrs } from '../tiptapFootnote';

function makeFootnote(overrides: Partial<FootnoteAttrs> = {}): FootnoteAttrs {
  return {
    footnoteNumber: 1,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] }] },
    author: '',
    title: '',
    source: '',
    pinpoint: '',
    year: '',
    ...overrides,
  };
}

describe('FootnotePanel', () => {
  it('renders the footnote number heading when open', () => {
    render(
      <FootnotePanel
        open
        onOpenChange={vi.fn()}
        footnote={makeFootnote({ footnoteNumber: 3 })}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        anchor={<button type="button">3</button>}
      />,
    );

    expect(screen.getByText('Footnote 3')).toBeInTheDocument();
  });

  it('shows inline missing-field errors for required fields left empty', () => {
    render(
      <FootnotePanel
        open
        onOpenChange={vi.fn()}
        footnote={makeFootnote()}
        citationConfig={{ requiredFields: ['author', 'year'] }}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        anchor={<button type="button">1</button>}
      />,
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Author is required.')).toBeInTheDocument();
    expect(screen.getByText('Year is required.')).toBeInTheDocument();
  });

  it('does not show missing-field errors when no citationConfig is provided', () => {
    render(
      <FootnotePanel
        open
        onOpenChange={vi.fn()}
        footnote={makeFootnote()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        anchor={<button type="button">1</button>}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables the Save button when required fields are missing', () => {
    render(
      <FootnotePanel
        open
        onOpenChange={vi.fn()}
        footnote={makeFootnote()}
        citationConfig={{ requiredFields: ['author'] }}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        anchor={<button type="button">1</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
