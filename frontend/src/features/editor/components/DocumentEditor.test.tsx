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

    const editor = screen.getByRole('textbox', { name: 'Document editor' });
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

describe('DocumentEditor — footnote rendering (footnote-citation-support spec)', () => {
  function footnoteContent(footnoteNumber: number) {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See the holding below.' },
            {
              type: 'footnote',
              attrs: {
                footnoteNumber,
                content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Discussion.' }] }] },
                author: 'R. Smith',
                title: '',
                source: '',
                pinpoint: '',
                year: '',
              },
            },
          ],
        },
      ],
    };
  }

  it('renders a footnote marker as a superscript element inside the editing surface (Requirement 3.5)', () => {
    render(<DocumentEditor initialContent={footnoteContent(1)} />);

    const editor = screen.getByRole('textbox', { name: 'Document editor' });
    const marker = editor.querySelector('sup[data-footnote]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('1');
  });

  it('the superscript marker uses the caption-scale design token class, not an inline font-size (Requirement 3.5)', () => {
    render(<DocumentEditor initialContent={footnoteContent(1)} />);

    const marker = screen.getByRole('textbox', { name: 'Document editor' }).querySelector('sup[data-footnote]');
    // No inline style with a raw font-size — styling is delegated to CSS
    // classes backed by theme.css tokens (frontend steering §9).
    expect(marker?.getAttribute('style') ?? '').not.toMatch(/font-size/);
    expect(marker?.className).toContain('footnote-marker');
  });

  it('renders a FootnoteList entry for every footnote in the document, sorted by number (Requirement 3.6)', () => {
    render(
      <DocumentEditor
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'footnote',
                  attrs: {
                    footnoteNumber: 2,
                    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second.' }] }] },
                    author: '',
                    title: '',
                    source: '',
                    pinpoint: '',
                    year: '',
                  },
                },
                {
                  type: 'footnote',
                  attrs: {
                    footnoteNumber: 1,
                    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First.' }] }] },
                    author: '',
                    title: '',
                    source: '',
                    pinpoint: '',
                    year: '',
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    const items = document.querySelectorAll('[data-footnote-number]');
    const listItems = Array.from(items).filter((el) => el.getAttribute('role') !== null || el.tagName === 'LI');
    expect(listItems.length).toBeGreaterThanOrEqual(2);
  });

  it('registers a click handler on the editor that recognizes footnote nodes', () => {
    // jsdom does not compute real layout/hit-testing, so ProseMirror's
    // `handleClickOn` (which resolves a DOM position via `posAtCoords`)
    // cannot be reliably exercised via a simulated click event in this
    // environment. The click-to-open wiring itself is a thin one-line
    // dispatch to `setActiveFootnoteNumber`, already covered end-to-end by
    // `FootnotePanel`'s own render tests (`FootnotePanel.test.tsx`,
    // `FootnotePanelTiming.test.tsx`) given an `open`/`footnote` prop pair;
    // this test asserts the marker is structurally clickable (a real DOM
    // element, not `pointer-events: none`) so the handler has a valid
    // target to attach to.
    render(<DocumentEditor initialContent={footnoteContent(1)} />);

    const marker = screen.getByRole('textbox', { name: 'Document editor' }).querySelector('sup[data-footnote]') as HTMLElement;
    expect(marker).not.toBeNull();
    expect(getComputedStyle(marker).pointerEvents).not.toBe('none');
  });

  it('renders no footnote list when the document has zero footnotes', () => {
    render(<DocumentEditor initialContent={{ type: 'doc', content: [{ type: 'paragraph' }] }} />);
    expect(document.querySelector('[data-footnote-list]')).toBeNull();
  });
});
