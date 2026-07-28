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
});
