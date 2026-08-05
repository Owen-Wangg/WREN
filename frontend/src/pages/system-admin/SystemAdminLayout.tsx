import { NavLink, Outlet } from 'react-router-dom';
import { Home, Info, User } from 'lucide-react';

import { appConfig } from '@/config/env';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { useUnreadCount } from '@/features/notifications/hooks/useNotificationActions';
import { useApiClient } from '@/services/apiClient';

const navItems = [
  { to: '/system-admin', label: 'Dashboard', icon: Home },
  { to: '/system-admin/guide', label: 'Guide', icon: Info },
  { to: '/system-admin/notifications', label: 'Notifications', icon: undefined },
  { to: '/system-admin/profile', label: 'Profile', icon: User },
] as const;

export function SystemAdminLayout() {
  const client = useApiClient();
  const { data: unreadCount } = useUnreadCount({ client });

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <header className="border-b border-border-subtle bg-surface-primary">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-xl py-md">
          <div className="flex items-center gap-md">
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
          </div>

          <nav className="flex items-center gap-xl" aria-label="Main navigation">
            {navItems.filter(item => item.icon).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'flex flex-col items-center gap-xs text-caption font-sans',
                    isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
                  ].join(' ')
                }
              >
                {item.icon && <item.icon size={22} aria-hidden="true" />}
                <span>{item.label}</span>
              </NavLink>
            ))}
            <NotificationBell unreadCount={unreadCount ?? 0} />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-xl py-2xl">
        <Outlet />
      </main>
    </div>
  );
}
