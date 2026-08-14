import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrintPreviewModal } from './PrintPreviewModal';

vi.mock('../pdfExport', () => ({
  tiptapContentToPdfBlob: vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
}));

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('PrintPreviewModal', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('is not in the document when closed', () => {
    render(
      <PrintPreviewModal
        open={false}
        onOpenChange={() => undefined}
        content={EMPTY_DOC}
        documentTitle="Essay"
      />,
    );
    expect(screen.queryByText('Print preview')).toBeNull();
  });

  it('shows a loading state then an iframe when opened', async () => {
    render(
      <PrintPreviewModal
        open={true}
        onOpenChange={() => undefined}
        content={EMPTY_DOC}
        documentTitle="Essay"
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Print preview' })).toBeInTheDocument();
    const frame = await screen.findByTitle('Print preview');
    expect(frame).toHaveAttribute('src', 'blob:preview');
  });
});
