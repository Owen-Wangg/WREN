import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SystemAdminGuidePage } from './SystemAdminGuidePage';

describe('SystemAdminGuidePage', () => {
  it('renders each guide section with a heading', () => {
    render(<SystemAdminGuidePage />);

    for (const name of [
      'System configuration',
      'Departments',
      'Who can submit and who can see a department',
      'Roles',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { level: 3, name: 'System Admins can:' })).toBeInTheDocument();
  });

  it('uses plain, user-facing wording', () => {
    render(<SystemAdminGuidePage />);
    const text = document.body.textContent ?? '';

    expect(text).not.toContain('Technical Admin');
    expect(text).not.toMatch(/discover/i);
    expect(text).not.toContain('then open one to');
    expect(text).toContain('Create departments from the dashboard, then manage each department by');
  });
});
