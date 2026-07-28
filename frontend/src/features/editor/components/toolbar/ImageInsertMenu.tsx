/**
 * Insert image via upload (data URL) or URL — Phase 5.
 * Resize handles deferred; images are max-width constrained in CSS.
 */
import { ImagePlus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';

export interface ImageInsertMenuProps {
  readonly disabled?: boolean;
  readonly onInsert: (src: string) => void;
}

export function ImageInsertMenu({ disabled = false, onInsert }: ImageInsertMenuProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
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

  const insertUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Enter an image URL.');
      return;
    }
    if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('data:image/')) {
      setError('Use an http(s) or data:image URL.');
      return;
    }
    onInsert(trimmed);
    setUrl('');
    setError(null);
    setOpen(false);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    // Keep uploads modest for draft JSON persistence.
    if (file.size > 1.5 * 1024 * 1024) {
      setError('Image must be under 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onInsert(reader.result);
        setError(null);
        setOpen(false);
      }
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Insert image"
        title="Insert image"
        className={[
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          'text-text-secondary transition-colors',
          'hover:bg-surface-muted hover:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
          'disabled:pointer-events-none disabled:opacity-40',
          open ? 'bg-accent-primary/10 text-accent-primary' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          setError(null);
          setOpen((value) => !value);
        }}
      >
        <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Insert image"
          className="absolute left-0 top-full z-50 mt-xs w-64 rounded-md border border-border-subtle bg-surface-primary p-md shadow-md"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={onFileChange}
          />
          <button
            type="button"
            className="mb-sm w-full rounded-md border border-border-subtle px-md py-sm text-left text-bodySmall font-sans text-text-primary hover:bg-surface-muted"
            onClick={() => fileRef.current?.click()}
          >
            Upload from device
          </button>
          <label className="mb-xs block text-caption font-sans font-medium text-text-secondary">
            Or paste image URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            className="mb-sm w-full rounded-md border border-border-subtle bg-surface-primary px-sm py-xs text-bodySmall text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                insertUrl();
              }
            }}
          />
          <button
            type="button"
            className="w-full rounded-md bg-accent-primary px-md py-xs text-bodySmall font-sans font-semibold text-text-on-accent"
            onClick={insertUrl}
          >
            Insert URL
          </button>
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
