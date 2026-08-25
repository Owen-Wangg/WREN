import { appConfig } from '@/config/env';

export function SystemAdminGuidePage() {
  const appName = appConfig.appName;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-4xl font-bold text-gray-900">System Admin Guide</h1>

      <div className="space-y-8 text-gray-700">
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">System configuration</h2>
          <p className="mb-4">
            From the dashboard you set platform-wide values that apply to every department:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Model Configuration</strong> — choose the Bedrock model used for AI
              Debrief and Ask {appName}. Existing debriefs are unchanged.
            </li>
            <li>
              <strong>Usage Limits</strong> — lifetime maxima for Ask {appName} messages, AI
              Debrief generations, uploads, and drafts per document.
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">Departments</h2>
          <p className="mb-4">
            Create departments from the dashboard, then open one to:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Lock or open student self-serve access (locking does not delete data)</li>
            <li>Manage users and roles (Student, DepartmentAdmin, TechnicalAdmin)</li>
            <li>
              Edit the department prompt: context, writing standards, and restricted topics
            </li>
            <li>View aggregate analytics (documents, drafts, active users, usage over time)</li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">Roles</h2>
          <p>
            In the app this view is labeled System Admin. In the API and database the role
            is <code>TechnicalAdmin</code>. Educational rubrics stay with Department Admins;
            this role does not replace their document-type configuration.
          </p>
        </section>
      </div>
    </div>
  );
}
