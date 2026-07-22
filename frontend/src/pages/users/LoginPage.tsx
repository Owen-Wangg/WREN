import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

import { LoginForm } from '@/features/auth/components/LoginForm';
import { useAuth } from '@/features/auth/AuthContext';

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, user, isLoading, activeRole } = useAuth();
  const [isWaitingForRedirect, setIsWaitingForRedirect] = useState(false);

  const handleLoginSuccess = async (email: string, password: string) => {
    try {
      // Sign in through auth context to fetch user roles from database
      await signIn(email, password);
      setIsWaitingForRedirect(true);
    } catch (error) {
      console.error('Failed to sign in through auth context:', error);
      setIsWaitingForRedirect(false);
    }
  };

  useEffect(() => {
    // Redirect once user is populated from auth context
    if (isWaitingForRedirect && !isLoading && user) {
      // Prefer the Profile "view as" choice when set; otherwise primary DB role.
      const role = activeRole;
      if (role === 'TechnicalAdmin') {
        navigate('/system-admin', { replace: true });
      } else if (role === 'DepartmentAdmin') {
        navigate('/dept-admin', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [isWaitingForRedirect, user, isLoading, activeRole, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="flex w-full max-w-[480px] flex-col gap-xl">
        <LoginForm onSuccess={handleLoginSuccess} />

        <div className="flex flex-col items-center gap-sm">
          <span className="text-bodySmall text-text-muted">
            New here?
          </span>
          <button
            type="button"
            onClick={() => navigate('/signup')}
            className="rounded-md bg-accent-primary px-xl py-xs text-bodySmall font-sans font-medium text-text-on-accent"
          >
            Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}
