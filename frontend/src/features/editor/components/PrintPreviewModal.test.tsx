import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrintPreviewModal } from './PrintPreviewModal';

describe('PrintPreviewModal', () => {
  const buildPdf = vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }));

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    buildPdf.mockClear();
  });

  it('is not in the document when closed', () => {
    render(
      <PrintPreviewModal
        open={false}
        onOpenChange={() => undefined}
        documentTitle="Essay"
        subtitle="US Letter · not editable"
        buildPdf={buildPdf}
      />,
    );
    expect(screen.queryByText('Print preview')).toBeNull();
    expect(buildPdf).not.toHaveBeenCalled();
  });

  it('shows a loading state then an iframe when opened', async () => {
    render(
      <PrintPreviewModal
        open={true}
        onOpenChange={() => undefined}
        documentTitle="Essay"
        subtitle="US Letter · with AI Debrief · not editable"
        buildPdf={buildPdf}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Print preview' })).toBeInTheDocument();
    expect(screen.getByText(/with AI Debrief/)).toBeInTheDocument();
    const frame = await screen.findByTitle('Print preview');
    expect(frame).toHaveAttribute('src', 'blob:preview');
    expect(buildPdf).toHaveBeenCalledTimes(1);
  });
});
