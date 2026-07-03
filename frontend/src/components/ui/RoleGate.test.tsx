import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RoleProvider } from '@/app/RoleContext';

import { RoleGate } from './RoleGate';

describe('RoleGate', () => {
  it('renders children when the explicit role is in the allow list', () => {
    render(
      <RoleGate allow={['Field Expert', 'Admin']} role="Field Expert">
        <p>Field Expert only content</p>
      </RoleGate>,
    );

    expect(screen.getByText('Field Expert only content')).toBeInTheDocument();
  });

  it('renders nothing (no fallback) when the role is not permitted', () => {
    render(
      <RoleGate allow={['Admin']} role="User">
        <p>Admin only content</p>
      </RoleGate>,
    );

    expect(screen.queryByText('Admin only content')).not.toBeInTheDocument();
  });

  it('renders the provided fallback when the role check fails', () => {
    render(
      <RoleGate allow={['Admin']} role="User" fallback={<p>No access</p>}>
        <p>Admin only content</p>
      </RoleGate>,
    );

    expect(screen.getByText('No access')).toBeInTheDocument();
    expect(screen.queryByText('Admin only content')).not.toBeInTheDocument();
  });

  it('renders nothing when the role is unknown (null)', () => {
    render(
      <RoleGate allow={['User', 'Field Expert', 'Org Owner', 'Admin']} role={null}>
        <p>Any role content</p>
      </RoleGate>,
    );

    expect(screen.queryByText('Any role content')).not.toBeInTheDocument();
  });

  it('supports every persona role without hardcoding a student-only assumption (steering §2)', () => {
    const roles = ['User', 'Field Expert', 'Org Owner', 'Admin'] as const;
    for (const role of roles) {
      render(
        <RoleGate allow={roles} role={role}>
          <span data-testid={`content-${role}`}>ok</span>
        </RoleGate>,
      );
      expect(screen.getByTestId(`content-${role}`)).toBeInTheDocument();
    }
  });

  it('falls back to RoleContext when no explicit role prop is given', () => {
    render(
      <RoleProvider role="Org Owner">
        <RoleGate allow={['Org Owner']}>
          <p>From context</p>
        </RoleGate>
      </RoleProvider>,
    );

    expect(screen.getByText('From context')).toBeInTheDocument();
  });
});
