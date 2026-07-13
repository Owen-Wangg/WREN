import { useNavigate } from 'react-router-dom';

export function SystemAdminProfilePage() {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-4xl font-bold text-gray-900">Profile</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-8">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Name</label>
            <p className="text-gray-700">System Administrator</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Email</label>
            <p className="text-gray-700">admin@example.com</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Role</label>
            <p className="text-gray-700">System Admin</p>
          </div>

          <hr className="border-gray-200" />

          <button
            onClick={() => navigate('/')}
            className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
