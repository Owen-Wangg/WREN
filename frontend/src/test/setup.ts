/**
 * Vitest global setup: extends `expect` with jest-dom matchers and clears the
 * DOM between tests.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * jsdom doesn't implement `Document#elementFromPoint` (only a stub that
 * returns `null` on some versions, and is missing entirely on others), but
 * ProseMirror's mousedown handler (used by Tiptap, task 18.1/18.2) calls it
 * unconditionally when resolving a click position. Without this polyfill,
 * `userEvent.click`/`fireEvent.click` on any node inside a Tiptap editor
 * throws `elementFromPoint is not a function` in every test file that
 * simulates a click in the editor (e.g. clicking a comment-mark span).
 * Returning `null` is safe: ProseMirror's `posAtCoords` falls back to its own
 * bounding-rect based resolution when `elementFromPoint` yields no element.
 */
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}
