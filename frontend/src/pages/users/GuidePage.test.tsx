import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GuidePage } from './GuidePage';

describe('GuidePage', () => {
  it('describes the department list from the user point of view', () => {
    render(<GuidePage />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('The department list shows the departments available to you.');
  });

  it('points students to the Request access button for locked document types', () => {
    render(<GuidePage />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('click Request access next to the locked document type');
    expect(text).toContain('If a department you expect is missing, contact your System Admin.');
  });

  it('leaves out admin and internal wording', () => {
    render(<GuidePage />);
    const text = document.body.textContent ?? '';

    expect(text).not.toMatch(/discover/i);
    for (const phrase of ['Technical Admin', 'Department Admin', 'Access Grant', 'Student Dashboard']) {
      expect(text).not.toContain(phrase);
    }
    expect(text).not.toMatch(/\brail\b/);
  });
});
