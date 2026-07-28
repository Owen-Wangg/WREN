/**
 * Compact menu button for toolbar dropdowns (headings, later font size, etc.).
 */
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ToolbarMenuOption {
  readonly id: string;
  readonly label: string;
  readonly active?: boolean;
  readonly onSelect: () => void;
}

export interface ToolbarDropdownProps {
  readonly label: string;
  readonly displayLabel: string;
  readonly options: readonly ToolbarMenuOption[];
  readonly disabled?: boolean;
  /** Optional extra classes on the trigger (e.g. narrower font-size control). */
  readonly triggerClassName?: string;
}

export function ToolbarDropdown({
  label,
  displayLabel,
  options,
  disabled = false,
  triggerClassName,
}: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

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
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={label}
        className={[
          'inline-flex h-8 min-w-[7.5rem] items-center justify-between gap-xs rounded-md px-sm',
          'text-caption font-sans font-medium text-text-secondary whitespace-nowrap',
          'hover:bg-surface-muted hover:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
          'disabled:pointer-events-none disabled:opacity-40',
          open ? 'bg-surface-muted text-text-primary' : '',
          triggerClassName ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="overflow-visible">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-xs min-w-full overflow-hidden rounded-md border border-border-subtle bg-surface-primary py-xs shadow-md"
        >
          {options.map((option) => (
            <li key={option.id} role="option" aria-selected={!!option.active}>
              <button
                type="button"
                className={[
                  'flex w-full items-center px-md py-sm text-left text-bodySmall font-sans transition-colors',
                  option.active
                    ? 'bg-accent-primary/10 font-semibold text-accent-primary'
                    : 'text-text-primary hover:bg-surface-muted/80',
                ].join(' ')}
                onClick={() => {
                  option.onSelect();
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reserved for Phase 2+ custom trigger content. */
export type ToolbarDropdownTriggerSlot = ReactNode;
