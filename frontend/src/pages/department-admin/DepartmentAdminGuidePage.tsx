export function DepartmentAdminGuidePage() {
  return (
    <div className="p-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">Department Admin Guide</h1>

      <div className="max-w-3xl space-y-8">
        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Getting Started</h2>
          <p className="text-gray-700">
            As a Department Admin, you manage document types and templates for your assigned department.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Managing Document Types</h2>
          <p className="mb-4 text-gray-700">
            Document types define the structure and templates available to users in your department.
          </p>
          <ul className="space-y-2 text-gray-700">
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900">•</span>
              <span>Create new document types for your department</span>
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900">•</span>
              <span>Edit document type settings and templates</span>
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900">•</span>
              <span>Delete document types when no longer needed</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Department Scope</h2>
          <p className="text-gray-700">
            All changes you make are scoped to your assigned department only. You can only view and manage
            document types and settings for your department.
          </p>
        </section>
      </div>
    </div>
  );
}
