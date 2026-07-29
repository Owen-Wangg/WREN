/**
 * Shared toolbar menu helpers — keep TipTap selection and escape overflow clipping.
 */
import {
  useEffect,
  useLayoutEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/** Prevent toolbar mousedown from clearing the editor selection / focus. */
export function preserveEditorSelection(event: ReactMouseEvent): void {
  event.preventDefault();
}

export interface FloatingMenuCoords {
  readonly top: number;
  readonly left: number;
  readonly minWidth: number;
}

/** Measure trigger → fixed coords for a portaled menu. */
export function useFloatingMenuCoords(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
): FloatingMenuCoords | null {
  const [coords, setCoords] = useState<FloatingMenuCoords | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }

    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const minWidth = Math.max(rect.width, 8.5 * 16);
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - minWidth - 8,
      );
      setCoords({
        top: rect.bottom + 4,
        left,
        minWidth,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, triggerRef]);

  return coords;
}

/** Close on outside pointer / Escape; supports a portaled panel ref. */
export function useDismissibleMenu(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      // Nested portaled menus (e.g. Line spacing inside More) live under body —
      // treat them as inside so option clicks aren't swallowed by parent dismiss.
      if (
        target instanceof Element &&
        target.closest('[data-document-editor-toolbar-menu]')
      ) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, triggerRef, panelRef]);
}

export function ToolbarPortal({
  coords,
  children,
  panelRef,
  className,
  role,
  id,
  'aria-label': ariaLabel,
}: {
  readonly coords: FloatingMenuCoords;
  readonly children: ReactNode;
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly className?: string;
  readonly role?: string;
  readonly id?: string;
  readonly 'aria-label'?: string;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      data-document-editor-toolbar-menu=""
      className={className}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        minWidth: coords.minWidth,
        zIndex: 200,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
