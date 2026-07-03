/**
 * Render/behavior tests for `<WrenChatPanel>` (task 18.6; Requirement 11.1).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WrenChatPanel } from './WrenChatPanel';

import { MockAskWrenService } from '../mockAskWrenService';

describe('WrenChatPanel', () => {
  it('renders the AI disclaimer notice', () => {
    render(
      <WrenChatPanel
        documentId="doc-1"
        draftId="draft-1"
        draftVersion={1}
        askWrenService={new MockAskWrenService()}
      />,
    );

    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('has no rewrite/apply/insert/accept button or interactive affordance anywhere in the panel', () => {
    render(
      <WrenChatPanel
        documentId="doc-1"
        draftId="draft-1"
        draftVersion={1}
        askWrenService={new MockAskWrenService()}
      />,
    );

    // The disclaimer copy itself legitimately says "will not rewrite your
    // text" — that is prose, not an affordance. What must never exist is an
    // interactive control (button/link) offering to apply/insert/rewrite.
    for (const forbidden of ['Apply', 'Insert', 'Accept', 'Rewrite']) {
      expect(
        screen.queryByRole('button', { name: new RegExp(forbidden, 'i') }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: new RegExp(forbidden, 'i') }),
      ).not.toBeInTheDocument();
    }

    // The only buttons in the whole panel are "Send" — no rewrite-adjacent action.
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Send']);
  });

  it('scopes sent messages to the provided draftId and shows the draft version', async () => {
    const service = new MockAskWrenService();
    const sendMessageSpy = vi.spyOn(service, 'sendMessage');
    const user = userEvent.setup();

    render(
      <WrenChatPanel
        documentId="doc-1"
        draftId="draft-42"
        draftVersion={3}
        askWrenService={service}
      />,
    );

    expect(screen.getByText(/draft version 3/i)).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Ask WREN a question about this draft'),
      'Is my thesis clear?',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledTimes(1));
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', draftId: 'draft-42' }),
    );
  });

  it('renders the Socratic reply as a plain message, never as replacement prose text', async () => {
    const user = userEvent.setup();
    render(
      <WrenChatPanel
        documentId="doc-1"
        draftId="draft-1"
        draftVersion={1}
        askWrenService={new MockAskWrenService()}
      />,
    );

    await user.type(
      screen.getByLabelText('Ask WREN a question about this draft'),
      'fix my intro',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const wrenReply = await screen.findByText(/what makes you say/i);
    expect(wrenReply).toBeInTheDocument();
  });
});
