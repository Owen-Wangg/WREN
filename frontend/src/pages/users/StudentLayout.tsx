import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FilePlus, FolderOpen, Info, Bell, User } from 'lucide-react';

import { appConfig } from '@/config/env';

const navItems = [
  { to: '/dashboard/new', label: 'New Document', icon: FilePlus },
  { to: '/dashboard', label: 'All Documents', icon: FolderOpen },
  { to: '/guide', label: 'Guide', icon: Info },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: User },
] as const;

export function StudentLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <header className="border-b border-border-subtle bg-surface-primary">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-xl py-md">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-md"
          >
            <div className="flex h-[40px] w-[40px] items-center justify-center rounded-md border border-border-subtle">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="7" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="12" y="3" width="9" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <line x1="14" y1="7" x2="19" y2="7" stroke="currentColor" strokeWidth="1" />
                <line x1="14" y1="10" x2="19" y2="10" stroke="currentColor" strokeWidth="1" />
                <line x1="14" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1" />
              </svg>
            </div>
            <span className="text-heading3 font-sans font-semibold text-text-primary">
              {appConfig.appName}
            </span>
          </button>

          <nav className="flex items-center gap-xl" aria-label="Main navigation">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/dashboard'}
                className={({ isActive }) =>
                  [
                    'flex flex-col items-center gap-xs text-caption font-sans',
                    isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
                  ].join(' ')
                }
              >
                <item.icon size={22} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-xl py-2xl">
        <Outlet />
      </main>
    </div>
  );
}
