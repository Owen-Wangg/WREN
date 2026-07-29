/**
 * Compact menu button for toolbar dropdowns (font, size, headings, etc.).
 * Menus portal to document.body so they are not clipped by toolbar overflow.
 */
import { ChevronDown } from 'lucide-react';
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';

import {
  preserveEditorSelection,
  ToolbarPortal,
  useDismissibleMenu,
  useFloatingMenuCoords,
} from './toolbarMenuUtils';

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const coords = useFloatingMenuCoords(open, triggerRef);
  const onClose = useCallback(() => setOpen(false), []);
  useDismissibleMenu(open, onClose, triggerRef, panelRef);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={label}
        className={[
          'inline-flex h-8 min-w-[7.5rem] items-center justify-between gap-xs rounded-md border px-sm',
          'border-border-subtle bg-surface-primary text-caption font-sans font-medium leading-normal',
          'text-text-secondary whitespace-nowrap shadow-sm',
          'hover:border-border-strong hover:bg-surface-muted hover:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
          'disabled:pointer-events-none disabled:opacity-40',
          open ? 'border-accent-primary/50 bg-surface-muted text-text-primary' : '',
          triggerClassName ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={preserveEditorSelection}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 overflow-hidden text-ellipsis leading-normal">
          {displayLabel}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && coords && (
        <ToolbarPortal
          coords={coords}
          panelRef={panelRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="max-h-[min(20rem,70vh)] overflow-y-auto rounded-md border border-border-subtle bg-surface-primary py-xs shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={!!option.active}
              className={[
                'flex w-full items-center px-md py-sm text-left text-bodySmall font-sans transition-colors',
                option.active
                  ? 'bg-accent-primary/10 font-semibold text-accent-primary'
                  : 'text-text-primary hover:bg-surface-muted/80',
              ].join(' ')}
              onMouseDown={preserveEditorSelection}
              onClick={() => {
                option.onSelect();
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </ToolbarPortal>
      )}
    </div>
  );
}

/** Reserved for Phase 2+ custom trigger content. */
export type ToolbarDropdownTriggerSlot = ReactNode;
