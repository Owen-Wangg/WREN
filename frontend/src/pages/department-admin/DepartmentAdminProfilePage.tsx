import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/features/auth/AuthContext';
import { ProfileRoleSwitcher } from '@/features/auth/components/ProfileRoleSwitcher';

export function DepartmentAdminProfilePage() {
  const navigate = useNavigate();
  const { user, signOut, activeRole } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="p-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">Profile</h1>

      <div className="max-w-3xl">
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-900">Name</label>
              <p className="mt-1 text-gray-700">{user?.email ?? 'Department Administrator'}</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900">Email</label>
              <p className="mt-1 text-gray-700">{user?.email ?? '—'}</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900">Active role</label>
              <p className="mt-1 text-gray-700">{activeRole}</p>
            </div>

            <ProfileRoleSwitcher />

            <hr className="border-gray-200" />

            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
