/**
 * Render tests for `<Citation>` (task 18.6; Requirements 21.1–21.4).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Citation } from './Citation';

describe('Citation', () => {
  it('renders the source title and section when citation data is present', () => {
    render(<Citation citation={{ title: 'Stinchcombe', section: 'para 12' }} />);

    expect(screen.getByText('Source: Stinchcombe, para 12')).toBeInTheDocument();
  });

  it('renders only the title when no section is provided', () => {
    render(<Citation citation={{ title: 'Villaroman' }} />);

    expect(screen.getByText('Source: Villaroman')).toBeInTheDocument();
  });

  it('renders nothing when no citation data is present (no Reference Material informed the item)', () => {
    const { container } = render(<Citation citation={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
