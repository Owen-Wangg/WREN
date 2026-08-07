/**
 * Editing Continuity unit tests (Task 11.5).
 *
 * Verifies that PaginationController properly debounces recalculation using
 * requestAnimationFrame and setTimeout, and that destroy() cleans up pending
 * timers correctly.
 *
 * @see Requirements 2.4, 2.5, 13.1, 13.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaginationController } from './PaginationController';
import type { PaginationOptions } from './types';

// ---------------------------------------------------------------------------
// Test setup — mock DOM and rAF/setTimeout
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: PaginationOptions = {
  pageHeight: 1056,
  pageWidth: 816,
  marginTop: 96,
  marginBottom: 96,
  marginLeft: 96,
  marginRight: 96,
  orphanLines: 2,
  widowLines: 2,
};

function createMockContentElement(): HTMLElement {
  const el = document.createElement('div');
  // Simulate block children for position lookup
  const p1 = document.createElement('p');
  p1.textContent = 'Hello world';
  const p2 = document.createElement('p');
  p2.textContent = 'Second paragraph with more text';
  const p3 = document.createElement('p');
  p3.textContent = 'Third paragraph';
  el.appendChild(p1);
  el.appendChild(p2);
  el.appendChild(p3);
  return el;
}

function createMockScrollContainer(): HTMLElement {
  return document.createElement('div');
}

function createController(): PaginationController {
  const content = createMockContentElement();
  const scroll = createMockScrollContainer();
  return new PaginationController(content, scroll, DEFAULT_OPTIONS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Editing Continuity — PaginationController debouncing (Task 11.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock requestAnimationFrame and cancelAnimationFrame
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(cb, 16) as unknown as number;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('requestRecalculation()', () => {
    it('uses requestAnimationFrame to schedule recalculation', () => {
      const controller = createController();

      controller.requestRecalculation();

      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));

      controller.destroy();
    });

    it('calling multiple times only schedules ONE rAF (debounce)', () => {
      const controller = createController();

      controller.requestRecalculation();
      controller.requestRecalculation();
      controller.requestRecalculation();
      controller.requestRecalculation();
      controller.requestRecalculation();

      // Only the first call should have triggered rAF
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      controller.destroy();
    });

    it('allows a new rAF after the previous one fires', () => {
      const controller = createController();

      controller.requestRecalculation();
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      // Fire the pending rAF
      vi.advanceTimersByTime(16);

      // Now another call should schedule a new rAF
      controller.requestRecalculation();
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);

      controller.destroy();
    });
  });

  describe('requestResizeRecalculation()', () => {
    it('uses 150ms setTimeout for resize debounce', () => {
      const controller = createController();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      controller.requestResizeRecalculation();

      // setTimeout should have been called with 150ms delay
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 150);

      controller.destroy();
    });

    it('clears previous timeout on subsequent calls (debounce)', () => {
      const controller = createController();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      controller.requestResizeRecalculation();
      const initialClearCount = clearTimeoutSpy.mock.calls.length;

      controller.requestResizeRecalculation();

      // clearTimeout should have been called to cancel the first timer
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(initialClearCount);

      controller.destroy();
    });

    it('only fires recalculation after 150ms elapses', () => {
      const controller = createController();
      const recalcSpy = vi.spyOn(controller, 'recalculateAll');

      controller.requestResizeRecalculation();

      // Not yet fired
      vi.advanceTimersByTime(100);
      expect(recalcSpy).not.toHaveBeenCalled();

      // Fire after 150ms
      vi.advanceTimersByTime(50);
      expect(recalcSpy).toHaveBeenCalledTimes(1);

      controller.destroy();
    });
  });

  describe('destroy()', () => {
    it('cancels pending rAF', () => {
      const controller = createController();

      controller.requestRecalculation();
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      controller.destroy();

      // cancelAnimationFrame should have been called
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('cancels pending setTimeout', () => {
      const controller = createController();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      controller.requestResizeRecalculation();

      controller.destroy();

      // clearTimeout should have been called to cancel the resize timer
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('prevents rAF callback from firing after destroy', () => {
      const controller = createController();
      const recalcSpy = vi.spyOn(controller, 'recalculateAll');

      controller.requestRecalculation();
      controller.destroy();

      // Advance past the rAF timing — callback should not fire
      vi.advanceTimersByTime(20);
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it('prevents resize callback from firing after destroy', () => {
      const controller = createController();
      const recalcSpy = vi.spyOn(controller, 'recalculateAll');

      controller.requestResizeRecalculation();
      controller.destroy();

      // Advance past the 150ms — callback should not fire
      vi.advanceTimersByTime(200);
      expect(recalcSpy).not.toHaveBeenCalled();
    });
  });

  describe('pageForPosition()', () => {
    it('returns 0 for position 0 (beginning of document)', () => {
      const controller = createController();
      const result = controller.pageForPosition(0);
      expect(result).toBe(0);
      controller.destroy();
    });

    it('returns correct page index for a position within the first block', () => {
      const controller = createController();
      // With default setup, all blocks are on page 0
      const result = controller.pageForPosition(5);
      expect(result).toBe(0);
      controller.destroy();
    });

    it('returns last page index for position beyond document end', () => {
      const controller = createController();
      // Position way beyond document content
      const result = controller.pageForPosition(99999);
      // Should return last page (pageCount - 1), which is 0 for default
      expect(result).toBe(0);
      controller.destroy();
    });

    it('returns correct page when blockPageMap has multi-page assignments', () => {
      const content = createMockContentElement();
      const scroll = createMockScrollContainer();
      const controller = new PaginationController(content, scroll, DEFAULT_OPTIONS);

      // Manually set blockPageMap to simulate multi-page layout
      // Block 0 → page 0, Block 1 → page 1, Block 2 → page 1
      const map = controller.blockPageMap;
      map.set(0, 0);
      map.set(1, 1);
      map.set(2, 1);

      // Position in first block (block 0) → page 0
      // "Hello world" = 11 chars + 1 boundary = 12
      const result0 = controller.pageForPosition(5);
      expect(result0).toBe(0);

      // Position in second block (block 1) → page 1
      // After block 0: 12 chars. Block 1 "Second paragraph..." = 31 chars + 1 boundary
      const result1 = controller.pageForPosition(15);
      expect(result1).toBe(1);

      controller.destroy();
    });
  });
});
