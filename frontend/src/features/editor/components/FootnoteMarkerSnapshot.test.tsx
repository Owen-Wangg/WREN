/**
 * Snapshot test for footnote superscript rendering (footnote-citation-support
 * spec, Task 5.7).
 *
 * Asserts markers render via the `text-caption` design-token class (the
 * closest available token to the 60-70%-of-body-text guidance — 12px
 * caption / 16px body = 75%, documented in `FootnoteList.tsx`'s header
 * comment as a pragmatic choice given the available type scale), never an
 * inline `font-size`.
 *
 * Validates: Requirement 3.5
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentEditor } from './DocumentEditor';

describe('footnote superscript rendering snapshot', () => {
  it('renders the marker as <sup data-footnote> with no inline font-size', () => {
    render(
      <DocumentEditor
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Body text ' },
                {
                  type: 'footnote',
                  attrs: {
                    footnoteNumber: 1,
                    content: { type: 'doc', content: [{ type: 'paragraph' }] },
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

    const marker = screen.getByRole('textbox').querySelector('sup[data-footnote]');
    expect(marker?.outerHTML).toMatchSnapshot();
  });
});
