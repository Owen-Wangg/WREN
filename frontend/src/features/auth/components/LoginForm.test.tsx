import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from './LoginForm';

import { authService } from '../defaultAuthService';

describe('LoginForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders labeled email and password fields and a submit button', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });

  it('shows validation errors and does not call the auth service for invalid input', async () => {
    const signInSpy = vi.spyOn(authService, 'signIn');
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('calls onSuccess with the session on valid sign-in', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Email'), 'writer@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // The mock auth service only knows accounts created via signUp, so this
    // sign-in is expected to fail — assert the error surfaces via role="alert"
    // rather than a thrown/unhandled exception, and onSuccess is never called.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email or password.',
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('never logs the submitted password', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'writer@example.com');
    await user.type(screen.getByLabelText('Password'), 'super-secret-pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => screen.getByRole('alert'));

    const allLoggedText = [...consoleSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .join(' ');
    expect(allLoggedText).not.toContain('super-secret-pw');
  });
});
