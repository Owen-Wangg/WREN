import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignupForm } from './SignupForm';

describe('SignupForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders labeled fields for name, email, and password confirmation', () => {
    render(<SignupForm />);

    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeInTheDocument();
  });

  it('shows a validation error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(
      screen.getByLabelText('Confirm password'),
      'different123',
    );
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Passwords do not match.'),
    ).toBeInTheDocument();
  });

  it('calls onSuccess after a valid sign-up', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<SignupForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ confirmationRequired: false }),
      );
    });
  });

  it('surfaces an error and does not call onSuccess for a duplicate email', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<SignupForm onSuccess={onSuccess} />);

    const fillAndSubmit = async () => {
      await user.type(screen.getByLabelText('First name'), 'Ada');
      await user.type(screen.getByLabelText('Last name'), 'Lovelace');
      await user.type(screen.getByLabelText('Email'), 'dup@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.type(
        screen.getByLabelText('Confirm password'),
        'password123',
      );
      await user.click(
        screen.getByRole('button', { name: 'Create account' }),
      );
    };

    await fillAndSubmit();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    cleanup();

    render(<SignupForm onSuccess={onSuccess} />);
    await fillAndSubmit();

    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
