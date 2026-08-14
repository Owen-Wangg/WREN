/**
 * Unified export panel for the document editor left rail.
 * Format (DOCX / PDF) + optional AI Debrief inclusion, with Preview and Export.
 */
import { ChevronUp, Download } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export type ExportFormat = 'docx' | 'pdf';

export interface ExportOptions {
  readonly format: ExportFormat;
  readonly includeDebrief: boolean;
}

export interface ExportMenuProps {
  readonly busy: boolean;
  readonly error?: string;
  readonly debriefAvailable: boolean;
  /** Shown via native title when the debrief checkbox is disabled. */
  readonly debriefDisabledReason: string;
  readonly triggerClassName: string;
  readonly onExport: (options: ExportOptions) => void;
  readonly onPreview: (options: ExportOptions) => void;
}

export function ExportMenu({
  busy,
  error,
  debriefAvailable,
  debriefDisabledReason,
  triggerClassName,
  onExport,
  onPreview,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [includeDebrief, setIncludeDebrief] = useState(false);
  const panelId = useId();
  const debriefCheckboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // If debrief becomes unavailable while checked, clear the toggle.
  useEffect(() => {
    if (!debriefAvailable && includeDebrief) {
      setIncludeDebrief(false);
    }
  }, [debriefAvailable, includeDebrief]);

  // Debrief export is PDF-only — snap format when toggling on.
  useEffect(() => {
    if (includeDebrief && format !== 'pdf') {
      setFormat('pdf');
    }
  }, [includeDebrief, format]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Close after a successful export (busy → idle with no new error while open).
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (wasBusy && !busy && !error) {
      setOpen(false);
    }
  }, [busy, error]);

  const effectiveFormat: ExportFormat = includeDebrief ? 'pdf' : format;
  const debriefToggleDisabled = !debriefAvailable || busy;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        title={error ?? (busy ? 'Preparing export…' : 'Export')}
        aria-label={busy ? 'Preparing export' : 'Export'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        className={triggerClassName}
      >
        {busy ? (
          <span
            className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <Download size={20} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span className="max-w-full px-[2px] text-caption font-sans font-medium leading-tight">
          {busy ? 'Exporting' : 'Export'}
        </span>
        <ChevronUp
          size={12}
          strokeWidth={2}
          className="text-text-muted"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Export options"
          className="absolute bottom-full left-0 z-30 mb-xs w-56 rounded-md border border-border-subtle bg-surface-primary p-md shadow-md"
        >
          <p className="mb-xs text-caption font-sans font-medium text-text-secondary">
            Format
          </p>
          <div
            className="mb-md flex gap-xs"
            role="group"
            aria-label="Export format"
          >
            {(['docx', 'pdf'] as const).map((value) => {
              const docxBlockedByDebrief = includeDebrief && value === 'docx';
              const selected = effectiveFormat === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy || docxBlockedByDebrief}
                  title={
                    docxBlockedByDebrief
                      ? 'AI Debrief export is available as PDF only'
                      : undefined
                  }
                  aria-pressed={selected}
                  className={[
                    'flex-1 rounded-md border px-sm py-xs text-caption font-sans font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    selected
                      ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
                      : 'border-border-subtle text-text-primary hover:bg-surface-muted',
                  ].join(' ')}
                  onClick={() => setFormat(value)}
                >
                  {value.toUpperCase()}
                </button>
              );
            })}
          </div>

          <div
            className="mb-md"
            title={!debriefAvailable ? debriefDisabledReason : undefined}
          >
            <label
              htmlFor={debriefCheckboxId}
              className={[
                'flex items-start gap-sm',
                debriefToggleDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              ].join(' ')}
            >
              <input
                id={debriefCheckboxId}
                type="checkbox"
                checked={includeDebrief}
                disabled={debriefToggleDisabled}
                onChange={(event) => setIncludeDebrief(event.target.checked)}
                className="mt-[2px] h-4 w-4 shrink-0 rounded border-border-strong text-accent-primary focus-visible:ring-2 focus-visible:ring-accent-primary/40 disabled:cursor-not-allowed"
              />
              <span className="text-caption font-sans leading-snug text-text-primary">
                Include AI Debrief
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-xs">
            <button
              type="button"
              disabled={busy}
              title={
                includeDebrief
                  ? 'Preview the document and AI Debrief as PDF'
                  : 'Preview as PDF (US Letter)'
              }
              className={[
                'inline-flex w-full items-center justify-center gap-sm rounded-md border border-border-subtle bg-surface-primary px-md py-xs',
                'text-caption font-sans font-semibold text-text-primary',
                'hover:bg-surface-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
                'disabled:cursor-not-allowed disabled:opacity-60',
              ].join(' ')}
              onClick={() => {
                onPreview({ format: effectiveFormat, includeDebrief });
                setOpen(false);
              }}
            >
              Preview
            </button>
            <button
              type="button"
              disabled={busy}
              className={[
                'inline-flex w-full items-center justify-center gap-sm rounded-md bg-accent-primary px-md py-xs',
                'text-caption font-sans font-semibold text-text-on-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
                'disabled:cursor-not-allowed disabled:opacity-60',
              ].join(' ')}
              onClick={() => onExport({ format: effectiveFormat, includeDebrief })}
            >
            {busy ? (
              <>
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-on-accent border-t-transparent"
                  aria-hidden="true"
                />
                Exporting…
              </>
            ) : (
              'Export'
            )}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-sm text-caption text-signal-critical">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
