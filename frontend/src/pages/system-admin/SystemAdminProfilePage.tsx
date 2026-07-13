export function SystemAdminProfilePage() {
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

          <button className="rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800">
            Edit Profile
          </button>
        </div>
      </div>
    </div>
  );
}
