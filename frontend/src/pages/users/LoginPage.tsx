import { useNavigate } from 'react-router-dom';

import { LoginForm } from '@/features/auth/components/LoginForm';
import { useAuth } from '@/features/auth/AuthContext';

export function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLoginSuccess = () => {
    if (!user) {
      navigate('/dashboard');
      return;
    }

    const primaryRole = user.roles[0];
    if (primaryRole === 'TechnicalAdmin') {
      navigate('/system-admin');
    } else if (primaryRole === 'DepartmentAdmin') {
      navigate('/dept-admin');
    } else {
      navigate('/dashboard');
    }
  };

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
