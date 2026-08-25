export function DepartmentAdminGuidePage() {
  return (
    <div className="p-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">Department Admin Guide</h1>

      <div className="max-w-3xl space-y-8 text-gray-700">
        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Getting started</h2>
          <p>
            You manage document types and evaluation rubrics for the department(s) you
            administer. Student AI Debriefs are generated against the rubric you save.
            If you administer more than one department, use the selector on the dashboard
            banner before you edit.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Document types</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Create a type from the dashboard, then open it to configure coaching.</li>
            <li>
              <strong>Evaluation Rubric</strong> holds Document Context (purpose, common
              mistakes, background, citation guide) and Evaluation Criteria. Click{' '}
              <strong>Save Rubric</strong> — this screen does not autosave.
            </li>
            <li>
              You can delete a type only when no documents still use it.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Analytics</h2>
          <p>
            Type-level Analytics shows aggregate student improvement, AI Debrief
            helpfulness ratings, and section applicability. These figures are not
            per-student scores and they do not change your rubric.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">Access</h2>
          <p>
            Whether students can self-serve this department (open vs locked) is
            controlled by a System Admin. Your changes apply only to departments you
            administer.
          </p>
        </section>
      </div>
    </div>
  );
}
