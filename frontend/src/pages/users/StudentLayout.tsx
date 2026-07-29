import { Outlet } from 'react-router-dom';

import { StudentTopBar } from '@/components/StudentTopBar';

export function StudentLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <StudentTopBar />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-xl py-2xl">
        <Outlet />
      </main>
    </div>
  );
}
