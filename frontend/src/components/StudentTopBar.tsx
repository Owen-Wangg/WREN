/**
 * Shared student chrome — logo + main nav used by the dashboard shell and
 * the document editor so both surfaces stay visually identical.
 */
import { NavLink, useNavigate } from 'react-router-dom';
import { FilePlus, FolderOpen, Info, User } from 'lucide-react';

import { appConfig } from '@/config/env';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { useUnreadCount } from '@/features/notifications/hooks/useNotificationActions';
import { useApiClient } from '@/services/apiClient';

const navItems = [
  { to: '/dashboard/new', label: 'New Document', icon: FilePlus },
  { to: '/dashboard', label: 'All Documents', icon: FolderOpen },
  { to: '/guide', label: 'Guide', icon: Info },
  { to: '/profile', label: 'Profile', icon: User },
] as const;

export function StudentTopBar() {
  const navigate = useNavigate();
  const client = useApiClient();
  const { data: unreadCount } = useUnreadCount({ client });

  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-primary">
      <div className="flex w-full items-center justify-between gap-lg px-xl py-md">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex shrink-0 items-center gap-md"
          aria-label={`${appConfig.appName} home`}
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

        <nav className="flex shrink-0 items-center gap-xl" aria-label="Main navigation">
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
          <NotificationBell unreadCount={unreadCount ?? 0} />
        </nav>
      </div>
    </header>
  );
}
