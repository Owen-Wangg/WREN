import { useNavigate } from 'react-router-dom';

export function DepartmentAdminProfilePage() {
  const navigate = useNavigate();

  return (
    <div className="p-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">Profile</h1>

      <div className="max-w-3xl">
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-900">Name</label>
              <p className="mt-1 text-gray-700">Department Administrator</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900">Email</label>
              <p className="mt-1 text-gray-700">admin@department.com</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900">Role</label>
              <p className="mt-1 text-gray-700">Department Admin</p>
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
    </div>
  );
}
