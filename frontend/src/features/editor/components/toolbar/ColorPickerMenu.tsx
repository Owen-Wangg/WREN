/**
 * Compact color swatch menu for text color / highlight (Phase 5).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ColorSwatch {
  readonly id: string;
  readonly label: string;
  /** CSS color value, or null to clear. */
  readonly value: string | null;
}

export interface ColorPickerMenuProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly colors: readonly ColorSwatch[];
  readonly activeValue?: string | null;
  readonly disabled?: boolean;
  readonly onSelect: (value: string | null) => void;
}

export function ColorPickerMenu({
  label,
  icon,
  colors,
  activeValue = null,
  disabled = false,
  onSelect,
}: ColorPickerMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        title={label}
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
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className="inline-flex flex-col items-center gap-[2px]">
          {icon}
          <span
            className="h-[3px] w-4 rounded-sm"
            style={{
              backgroundColor: activeValue ?? 'currentColor',
              opacity: activeValue ? 1 : 0.35,
            }}
          />
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-xs w-[11rem] rounded-md border border-border-subtle bg-surface-primary p-md shadow-md"
        >
          <div className="grid grid-cols-5 gap-xs">
            {colors.map((swatch) => {
              const isActive =
                (swatch.value == null && activeValue == null) ||
                (swatch.value != null &&
                  activeValue != null &&
                  swatch.value.toLowerCase() === activeValue.toLowerCase());
              return (
                <button
                  key={swatch.id}
                  type="button"
                  title={swatch.label}
                  aria-label={swatch.label}
                  aria-pressed={isActive}
                  className={[
                    'relative h-6 w-6 rounded-md border transition-transform hover:scale-105',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
                    isActive ? 'border-accent-primary ring-1 ring-accent-primary/40' : 'border-border-subtle',
                  ].join(' ')}
                  style={{
                    backgroundColor: swatch.value ?? '#ffffff',
                    backgroundImage:
                      swatch.value == null
                        ? 'linear-gradient(to top right, transparent calc(50% - 1px), #c00 50%, transparent calc(50% + 1px))'
                        : undefined,
                  }}
                  onClick={() => {
                    onSelect(swatch.value);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
