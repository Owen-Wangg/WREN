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
            <li>
              <strong>Student access: Open / Locked</strong> — controls submission. Open
              requires no document-type Access Grant; Locked requires one. It does not
              control login or catalog visibility.
            </li>
            <li>
              <strong>Department visibility: Visible / Permitted users only</strong> —
              controls student catalog and New Document discovery independently of Open or
              Locked.
            </li>
            <li>
              <strong>Permitted users</strong> — grant or revoke explicit discovery
              permission. Permissions are retained in both visibility modes and take effect
              whenever the department is Permitted users only.
            </li>
            <li>
              Technical Admins automatically discover every department. A Department Admin
              automatically discovers only departments they are appointed to, even while
              using the Student view. Revoking an explicit permission does not remove these
              automatic bypasses.
            </li>
            <li>Manage users and roles (Student, DepartmentAdmin, TechnicalAdmin)</li>
            <li>
              Edit the department prompt: context, writing standards, and restricted topics
            </li>
            <li>View aggregate analytics (documents, drafts, active users, usage over time)</li>
          </ul>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Not a confidentiality control:</strong> Department visibility filters
            normal catalog and New Document UI only. It is not a server-side security
            boundary, and direct API callers may still retrieve department metadata. A
            Permitted users only department that is Open is not protected from direct-API
            submission. Use Locked plus document-type Access Grants for submission
            enforcement.
          </p>
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
