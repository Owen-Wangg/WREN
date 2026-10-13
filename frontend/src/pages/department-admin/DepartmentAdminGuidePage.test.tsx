import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DepartmentAdminGuidePage } from './DepartmentAdminGuidePage';

describe('DepartmentAdminGuidePage', () => {
  it('renders exactly the Document Types, Analytics, and Access sections', () => {
    render(<DepartmentAdminGuidePage />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Document Types', 'Analytics', 'Access']);
  });

  it('renders the approved section text', () => {
    render(<DepartmentAdminGuidePage />);

    for (const paragraph of [
      'As a departmental administrator (admin), you create and manage document types, and create evaluation rubrics. To create the evaluation rubrics, select applicable criteria and fill out the prompts by clicking the drop-down arrow. This rubric will be used by the AI to produce AI Debriefs for the user.',
      'Department level analytics track aggregate student improvement across feedback categories. The department admin can view student improvement trends, as well as the helpfulness and applicability of the AI Debrief.',
      'Access to the department itself is controlled by the system administrator.',
    ]) {
      expect(screen.getByText(paragraph)).toBeInTheDocument();
    }
  });
});
