import { useNavigate } from 'react-router-dom';

import { appConfig } from '@/config/env';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted">
      <div className="flex flex-col items-center gap-3xl">
        <h1 className="text-title-hero font-sans font-bold tracking-tight text-text-primary">
          {appConfig.appName}
        </h1>

        <div className="flex items-center gap-lg">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="rounded-md border border-border-subtle bg-surface-primary px-2xl py-sm text-body font-sans font-medium text-text-primary shadow-sm hover:bg-surface-muted"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => navigate('/signup')}
            className="rounded-md bg-accent-primary px-2xl py-sm text-body font-sans font-medium text-text-on-accent shadow-md hover:opacity-90"
          >
            Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}
