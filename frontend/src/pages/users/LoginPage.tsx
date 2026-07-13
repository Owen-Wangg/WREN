import { useNavigate } from 'react-router-dom';

import { LoginForm } from '@/features/auth';

export function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="flex w-full max-w-[480px] flex-col gap-xl">
        <LoginForm onSuccess={() => navigate('/dashboard')} />

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
