/**
 * Insert-table control: Docs-style hover grid (up to 5×5) plus a11y labels.
 */
import { Table as TableIcon } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';

import {
  preserveEditorSelection,
  ToolbarPortal,
  useDismissibleMenu,
  useFloatingMenuCoords,
} from './toolbarMenuUtils';

const MAX_ROWS = 5;
const MAX_COLS = 5;

export interface TableInsertMenuProps {
  readonly disabled?: boolean;
  readonly onInsert: (rows: number, cols: number) => void;
}

export function TableInsertMenu({ disabled = false, onInsert }: TableInsertMenuProps) {
  const [open, setOpen] = useState(false);
  const [hoverRows, setHoverRows] = useState(1);
  const [hoverCols, setHoverCols] = useState(1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const coords = useFloatingMenuCoords(open, triggerRef);
  const onClose = useCallback(() => setOpen(false), []);
  useDismissibleMenu(open, onClose, triggerRef, panelRef);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Insert table"
        title="Insert table"
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
        onMouseDown={preserveEditorSelection}
        onClick={() => {
          setHoverRows(1);
          setHoverCols(1);
          setOpen((value) => !value);
        }}
      >
        <TableIcon size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open && coords && (
        <ToolbarPortal
          coords={coords}
          panelRef={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Choose table size"
          className="rounded-md border border-border-subtle bg-surface-primary p-md shadow-lg"
        >
          <p className="mb-sm text-caption font-sans font-medium text-text-secondary">
            {hoverRows} × {hoverCols} table
          </p>
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
            onMouseLeave={() => {
              setHoverRows(1);
              setHoverCols(1);
            }}
          >
            {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, index) => {
              const row = Math.floor(index / MAX_COLS) + 1;
              const col = (index % MAX_COLS) + 1;
              const active = row <= hoverRows && col <= hoverCols;
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  aria-label={`${row} by ${col} table`}
                  className={[
                    'h-4 w-4 rounded-[2px] border transition-colors',
                    active
                      ? 'border-accent-primary bg-accent-primary/20'
                      : 'border-border-subtle bg-surface-muted/40 hover:border-border-strong',
                  ].join(' ')}
                  onMouseEnter={() => {
                    setHoverRows(row);
                    setHoverCols(col);
                  }}
                  onMouseDown={preserveEditorSelection}
                  onClick={() => {
                    onInsert(row, col);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
        </ToolbarPortal>
      )}
    </div>
  );
}
