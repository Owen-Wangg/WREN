/**
 * FootnotePanel open timing unit test (Task 5.4, Requirement 3.2).
 *
 * Asserts the FootnotePanel popover renders open synchronously — i.e. when
 * the component is rendered with `open={true}`, the popover content is present
 * in the DOM immediately within the same render cycle (no async gate).
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_FOOTNOTE_BODY, type FootnoteAttrs } from '../tiptapFootnote';

import { FootnotePanel } from './FootnotePanel';

const SAMPLE_FOOTNOTE: FootnoteAttrs = {
  footnoteNumber: 1,
  content: EMPTY_FOOTNOTE_BODY,
  author: '',
  title: '',
  source: '',
  pinpoint: '',
  year: '',
};

describe('FootnotePanel open timing (Requirement 3.2)', () => {
  it('renders popover content synchronously when open={true} — same render cycle', () => {
    const { baseElement } = render(
      <FootnotePanel
        open={true}
        onOpenChange={vi.fn()}
        footnote={SAMPLE_FOOTNOTE}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        anchor={<button>1</button>}
      />,
    );

    // The popover content (rendered via Radix Portal) should be in the DOM
    // immediately after the synchronous render — no act() wrapping or
    // waitFor needed, proving it opens within the same render cycle.
    const panel = baseElement.ownerDocument.querySelector('[data-footnote-panel]');
    expect(panel).not.toBeNull();
    expect(panel).toBeInTheDocument();
  });

  it('does NOT render popover content when open={false}', () => {
    const { baseElement } = render(
      <FootnotePanel
        open={false}
        onOpenChange={vi.fn()}
        footnote={SAMPLE_FOOTNOTE}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        anchor={<button>1</button>}
      />,
    );

    const panel = baseElement.ownerDocument.querySelector('[data-footnote-panel]');
    expect(panel).toBeNull();
  });
});
