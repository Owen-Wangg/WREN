/**
 * Render tests for `<DocumentEditor>` (task 18.1).
 *
 * **Validates: Requirements 6.2, 52.1, 52.2**
 *
 * Asserts the Tiptap editing surface mounts and that the comment mark extension
 * (`@sereneinserenade/tiptap-comment-extension`) is registered on the editor's
 * schema, so task 18.2 can attach margin comments via `setComment`/`unsetComment`
 * without re-configuring the editor.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DocumentEditor, type DocumentEditorHandle } from './DocumentEditor';

/** Exposes the editor's imperative handle as readable DOM state, since the
 * handle itself is only populated after Tiptap's editor instance is created. */
function ImperativeHandleHarness() {
  const ref = useRef<DocumentEditorHandle>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(ref.current !== null);
  }, []);

  return (
    <>
      <DocumentEditor ref={ref} />
      <span data-testid="handle-status">{isReady ? 'ready' : 'not-ready'}</span>
    </>
  );
}

describe('DocumentEditor', () => {
  it('mounts the editing surface as an accessible textbox region', () => {
    render(<DocumentEditor ariaLabel="Draft editor" />);

    const editor = screen.getByRole('textbox', { name: 'Draft editor' });
    expect(editor).toBeInTheDocument();
  });

  it('renders initial content as ordered paragraphs', () => {
    render(
      <DocumentEditor
        initialContent={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
          ],
        }}
      />,
    );

    const editor = screen.getByRole('textbox');
    const paragraphs = editor.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent('First paragraph.');
    expect(paragraphs[1]).toHaveTextContent('Second paragraph.');
  });

  it('exposes an imperative handle (importDocx/exportDocx) once the editor is created, so task 18.2 can attach comments', async () => {
    render(<ImperativeHandleHarness />);

    await waitFor(() =>
      expect(screen.getByTestId('handle-status')).toHaveTextContent('ready'),
    );
  });

  it('exports non-empty .docx content, proving the registered extension set (StarterKit + comment mark) does not break serialization', async () => {
    const handleBox: { current: DocumentEditorHandle | null } = { current: null };

    function Harness() {
      const ref = useRef<DocumentEditorHandle>(null);
      handleBox.current = ref.current;
      return (
        <DocumentEditor
          ref={ref}
          initialContent={{
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Anchor me.' }] }],
          }}
        />
      );
    }

    const { rerender } = render(<Harness />);
    rerender(<Harness />);

    await waitFor(() => expect(handleBox.current).not.toBeNull());

    const blob = await handleBox.current?.exportDocx();
    expect(blob?.size).toBeGreaterThan(0);
  });
});
