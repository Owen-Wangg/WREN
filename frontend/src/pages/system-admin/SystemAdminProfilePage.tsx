import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/features/auth/AuthContext';
import { ProfileRoleSwitcher } from '@/features/auth/components/ProfileRoleSwitcher';

export function SystemAdminProfilePage() {
  const navigate = useNavigate();
  const { user, signOut, activeRole } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-4xl font-bold text-gray-900">Profile</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-8">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Name</label>
            <p className="text-gray-700">
              {user ? `${user.firstName} ${user.lastName}`.trim() || 'System Administrator' : 'System Administrator'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Email</label>
            <p className="text-gray-700">{user?.email ?? '—'}</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Active role</label>
            <p className="text-gray-700">{activeRole}</p>
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
  );
}
