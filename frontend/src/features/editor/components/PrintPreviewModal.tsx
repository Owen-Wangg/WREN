/**
 * Read-only print preview: renders the current document as a US Letter PDF
 * in a modal. Uses the same exporter as Download PDF. Does not paginate the
 * live editor.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { tiptapContentToPdfBlob } from '../pdfExport';
import { stripAiMarksFromTipTapContent } from '@wren/types';

import type { JSONContent } from '@tiptap/react';

export interface PrintPreviewModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly content: JSONContent;
  readonly header?: JSONContent | null;
  readonly footer?: JSONContent | null;
  readonly lastEditedAt?: string | null;
  readonly documentTitle: string;
}

export function PrintPreviewModal({
  open,
  onOpenChange,
  content,
  header,
  footer,
  lastEditedAt,
  documentTitle,
}: PrintPreviewModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(undefined);
      setBusy(false);
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setBusy(true);
    setError(undefined);
    setObjectUrl(null);

    const cleaned = stripAiMarksFromTipTapContent(content) as JSONContent;
    void tiptapContentToPdfBlob(cleaned, { header, footer, lastEditedAt })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setObjectUrl(url);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not build a print preview.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // Snapshot at open — do not rebuild while the user keeps typing behind the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional snapshot
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[90vh] w-[min(960px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border-strong bg-surface-primary shadow-lg"
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-start justify-between gap-md border-b border-border-subtle px-xl py-md">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-heading3 font-sans font-semibold text-text-primary">
                Print preview
              </Dialog.Title>
              <p className="mt-xs truncate text-caption font-sans text-text-muted" title={documentTitle}>
                {documentTitle} · US Letter · not editable
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close print preview"
                className="rounded-md p-xs text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 bg-surface-muted">
            {busy && (
              <div className="flex h-full items-center justify-center gap-sm text-body font-sans text-text-secondary">
                <span
                  className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent"
                  aria-hidden="true"
                />
                Building preview…
              </div>
            )}
            {error && (
              <p role="alert" className="p-xl text-body text-signal-critical">
                {error}
              </p>
            )}
            {objectUrl && !busy && (
              <iframe
                title="Print preview"
                src={objectUrl}
                className="h-full w-full border-0 bg-surface-muted"
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
