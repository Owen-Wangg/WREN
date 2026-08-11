/**
 * OCR low-confidence mark. Applied by scanned-PDF reconstruction when a LINE's
 * average WORD confidence is below 80%. Must be registered on the editor
 * schema or TipTap strips it on load.
 */
import { Mark, mergeAttributes } from '@tiptap/core';

export const LowConfidence = Mark.create({
  name: 'lowConfidence',
  inclusive: false,
  excludes: '',

  parseHTML() {
    return [{ tag: 'span[data-ocr-low-confidence]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ocr-low-confidence': 'true',
        class: 'ocr-low-confidence',
      }),
      0,
    ];
  },
});
