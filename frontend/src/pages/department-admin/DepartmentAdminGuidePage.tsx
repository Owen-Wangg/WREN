export function DepartmentAdminGuidePage() {
  return (
    <div className="p-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">Department Admin Guide</h1>

      <div className="max-w-3xl space-y-8 text-gray-700">
        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Document Types</h2>
          <p>
            As a departmental administrator (admin), you create and manage document types,
            and create evaluation rubrics. To create the evaluation rubrics, select
            applicable criteria and fill out the prompts by clicking the drop-down arrow.
            This rubric will be used by the AI to produce AI Debriefs for the user.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Analytics</h2>
          <p>
            Department level analytics track aggregate student improvement across feedback
            categories. The department admin can view student improvement trends, as well as
            the helpfulness and applicability of the AI Debrief.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Access</h2>
          <p>Access to the department itself is controlled by the system administrator.</p>
        </section>
      </div>
    </div>
  );
}
