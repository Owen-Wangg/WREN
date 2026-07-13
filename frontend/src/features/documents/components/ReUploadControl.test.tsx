/**
 * Render/behavior tests for `<ReUploadControl>` (task 18.6; Requirement 8.1).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReUploadControl } from './ReUploadControl';

import { MockDraftService } from '../mockDraftService';

function makeFile(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/plain' });
}

describe('ReUploadControl', () => {
  it('creates a new Draft (not a mutation of an existing one) when a file is re-uploaded', async () => {
    const draftService = new MockDraftService();
    await draftService.createDraft({
      documentId: 'doc-1',
      file: makeFile('v1.docx', 'first version'),
    });

    const onDraftCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <ReUploadControl
        documentId="doc-1"
        draftService={draftService}
        onDraftCreated={onDraftCreated}
      />,
    );

    const input = screen.getByLabelText('Re-Upload Document', { exact: false });
    await user.upload(input, makeFile('v2.docx', 'second version'));

    await waitFor(() => expect(onDraftCreated).toHaveBeenCalledTimes(1));
    const newDraft = onDraftCreated.mock.calls[0][0];
    expect(newDraft.versionNumber).toBe(2);

    const allDrafts = await draftService.getDrafts('doc-1');
    expect(allDrafts).toHaveLength(2);
    expect(allDrafts[0].versionNumber).toBe(1);
  });
});
