/**
 * Floating “Page X of Y” label beside the native scrollbar.
 * Browsers cannot put custom text on the OS thumb; this overlay follows it.
 */
import { useEffect, useState, type RefObject } from 'react';

import {
  formatPrintedPageHint,
  isPointInScrollbarGutter,
  printedPageFromScroll,
  scrollThumbCenterY,
} from '../printedPageFromScroll';

const SCROLLBAR_HIT_PX = 20;
const HIDE_MS = 900;

export interface ScrollPageHintProps {
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly pageCount: number;
}

interface HintLayout {
  readonly visible: boolean;
  readonly label: string;
  readonly topPx: number;
}

function layoutFromScroll(el: HTMLElement, pageCount: number, visible: boolean): HintLayout {
  const { scrollTop, scrollHeight, clientHeight } = el;
  const overflow = scrollHeight > clientHeight + 1;
  const current = printedPageFromScroll(scrollTop, scrollHeight, clientHeight, pageCount);
  return {
    visible: visible && overflow,
    label: formatPrintedPageHint(current, pageCount),
    topPx: scrollThumbCenterY(scrollTop, scrollHeight, clientHeight),
  };
}

export function ScrollPageHint({ scrollRef, pageCount }: ScrollPageHintProps) {
  const [hint, setHint] = useState<HintLayout>({ visible: false, label: '', topPx: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let hideTimer: number | undefined;
    let hovering = false;

    const showFromScroll = () => {
      setHint(layoutFromScroll(el, pageCount, true));
    };

    const scheduleHide = () => {
      if (hideTimer != null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!hovering) {
          setHint((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        }
      }, HIDE_MS);
    };

    const onScroll = () => {
      showFromScroll();
      if (!hovering) scheduleHide();
    };

    const onPointerMove = (event: PointerEvent) => {
      const overGutter = isPointInScrollbarGutter(
        event.clientX,
        event.clientY,
        el.getBoundingClientRect(),
        SCROLLBAR_HIT_PX,
      );
      if (overGutter) {
        hovering = true;
        if (hideTimer != null) window.clearTimeout(hideTimer);
        showFromScroll();
        return;
      }
      if (hovering) {
        hovering = false;
        scheduleHide();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('pointermove', onPointerMove);

    return () => {
      el.removeEventListener('scroll', onScroll);
      document.removeEventListener('pointermove', onPointerMove);
      if (hideTimer != null) window.clearTimeout(hideTimer);
    };
  }, [scrollRef, pageCount]);

  if (!hint.visible || !hint.label) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-xl z-20 -translate-y-1/2 rounded-sm bg-accent-primary px-sm py-xs text-caption font-sans font-medium text-text-on-accent shadow-sm"
      style={{ top: hint.topPx }}
    >
      {hint.label}
    </div>
  );
}
