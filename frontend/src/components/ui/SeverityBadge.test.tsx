import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { severityLevelMap } from './severityLevelMap';
import { SeverityBadge } from './SeverityBadge';

import type { SeverityLevel } from './severityLevelMap';

describe('SeverityBadge', () => {
  it.each<SeverityLevel>(['positive', 'caution', 'critical'])(
    'renders the qualitative label for level "%s" with no numeric content',
    (level) => {
      render(<SeverityBadge level={level} />);
      const label = severityLevelMap[level].label;
      const badge = screen.getByText(label);

      expect(badge).toBeInTheDocument();
      // Requirement 18.3 / design guardrail: severity is color, never a number.
      expect(badge.textContent).not.toMatch(/\d/);
    },
  );

  it('severityLevelMap never exposes a numeric score field', () => {
    for (const entry of Object.values(severityLevelMap)) {
      expect(Object.keys(entry)).not.toContain('score');
      expect(entry.label).not.toMatch(/\d/);
    }
  });
});
