/**
 * Phase 1 toolbar smoke tests — mounts with a live TipTap editor and
 * asserts core controls are present and toggleable.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DocumentEditor } from '../DocumentEditor';

describe('EditorToolbar (Phase 1)', () => {
  it('renders core formatting controls with accessible names', async () => {
    render(<DocumentEditor ariaLabel="Draft editor" />);

    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Underline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulleted list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text style' })).toBeInTheDocument();
  });

  it('toggles bold pressed state from the toolbar', async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        ariaLabel="Draft editor"
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello world' }],
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    });

    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');

    const surface = screen.getByRole('textbox', { name: 'Draft editor' });
    await user.click(surface);
    await user.keyboard('{Control>}a{/Control}');
    await user.click(bold);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('renders Phase 2 font size and alignment controls', async () => {
    render(<DocumentEditor ariaLabel="Draft editor" />);

    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Font size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Align left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Align center' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Align right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Justify' })).toBeInTheDocument();
  });

  it('applies center alignment and reflects pressed state', async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        ariaLabel="Draft editor"
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Centered title' }],
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Align center' })).toBeInTheDocument();
    });

    const surface = screen.getByRole('textbox', { name: 'Draft editor' });
    await user.click(surface);
    await user.click(screen.getByRole('button', { name: 'Align center' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Align center' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    const paragraph = surface.querySelector('p');
    expect(paragraph?.getAttribute('style') ?? '').toMatch(/text-align:\s*center/i);
  });

  it('renders Phase 3 indent and line spacing controls', async () => {
    render(<DocumentEditor ariaLabel="Draft editor" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Increase indent' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Decrease indent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Line spacing' })).toBeInTheDocument();
  });

  it('indents a paragraph via the toolbar', async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        ariaLabel="Draft editor"
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Indented body' }],
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Increase indent' })).toBeInTheDocument();
    });

    const surface = screen.getByRole('textbox', { name: 'Draft editor' });
    await user.click(surface);
    await user.click(screen.getByRole('button', { name: 'Increase indent' }));

    await waitFor(() => {
      const paragraph = surface.querySelector('p');
      expect(paragraph?.getAttribute('data-indent')).toBe('1');
    });
  });

  it('renders Phase 4 table controls', async () => {
    render(<DocumentEditor ariaLabel="Draft editor" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Insert table' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Add row below' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add column after' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Table actions' })).toBeDisabled();
  });

  it('inserts a table from the size grid and enables edit controls', async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        ariaLabel="Draft editor"
        initialContent={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Insert table' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Insert table' }));
    await user.click(screen.getByRole('button', { name: '2 by 2 table' }));

    await waitFor(() => {
      const surface = screen.getByRole('textbox', { name: 'Draft editor' });
      expect(surface.querySelector('table')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add row below' })).not.toBeDisabled();
    });
  });

  it('renders Phase 5 font family, color, and image controls', async () => {
    render(<DocumentEditor ariaLabel="Draft editor" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Font family' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Text color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Highlight color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument();
  });
});
