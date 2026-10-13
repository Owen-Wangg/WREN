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
            From the dashboard, you can set platform-wide values that apply to every department:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Model Configuration</strong> — choose the Amazon Bedrock AI model used for
              AI Debrief and Ask {appName}. Changing the model does not change debriefs that were
              already generated.
            </li>
            <li>
              <strong>Usage Limits</strong> — set the maximum number of Ask {appName} messages, AI
              Debriefs, uploads, and drafts allowed for each document. These are lifetime totals,
              not monthly or weekly limits.
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">Departments</h2>
          <p className="mb-4">
            Create departments from the dashboard, then manage each department by
            clicking <strong>Manage Department</strong> on its card. This takes you to that
            department&apos;s page.
          </p>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">System Admins can:</h3>
          <ul className="list-disc space-y-2 pl-5">
            <li>Manage users and assign roles (Student, Department Admin, or System Admin)</li>
            <li>
              Edit the department prompt: context, writing standards, and restricted topics
            </li>
            <li>
              View department analytics, such as documents, drafts, active users, and usage over
              time
            </li>
            <li>
              Choose who can submit documents to the department and who can see it in the
              department list (see below)
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">
            Who can submit and who can see a department
          </h2>
          <p className="mb-4">
            Each department has two separate settings. One controls who can submit documents.
            The other controls who can see the department in lists.
          </p>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">
            Student access: Open or Locked
          </h3>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>
              <strong>Open</strong> — any student can choose a document type in this department
              and start writing. No approval is needed.
            </li>
            <li>
              <strong>Locked</strong> — students must be given access to a document type before
              they can submit. Students can request access, and you approve requests on the
              department&apos;s page.
            </li>
            <li>
              This setting does not affect who can sign in, or whether the department appears in
              the department list.
            </li>
          </ul>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">
            Department visibility: Visible or Permitted users only
          </h3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Visible</strong> — everyone sees the department in the department list and
              when they create a new document.
            </li>
            <li>
              <strong>Permitted users only</strong> — only people you have given permission to
              can see the department. System Admins, and the Department Admins of that
              department, can always see it.
            </li>
            <li>
              <strong>Permitted users</strong> — use this list on the department&apos;s page to
              give or remove permission. The list is saved even while the department is Visible,
              and it applies again whenever you switch to Permitted users only.
            </li>
          </ul>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Visibility does not keep a department private.</strong> Permitted users only
            hides the department from lists in the app, but it is not a security setting. People
            who connect to the system directly, outside the app, can still see the
            department&apos;s details, and they can still submit to it if the department is Open.
            To control who can submit, set the department to Locked and give students access to
            specific document types.
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">Roles</h2>
          <p className="mb-4">There are three roles. One person can have more than one role.</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Student</strong> — writes and revises documents and gets feedback from AI
              Debrief and Ask {appName}.
            </li>
            <li>
              <strong>Department Admin</strong> — manages document types and evaluation rubrics
              for the departments they are appointed to. Department Admins always see their own
              departments in the department list, even when they switch to viewing as a Student
              with <strong>View as role</strong> on their Profile page.
            </li>
            <li>
              <strong>System Admin</strong> — manages platform settings, departments, users, and
              roles. System Admins always see every department in the department list. Document
              types and evaluation rubrics are set up by Department Admins.
            </li>
          </ul>
          <p className="mt-4">
            Removing a person&apos;s permission does not hide a department from System Admins or
            from that department&apos;s Department Admins.
          </p>
          <p className="mt-4 text-sm text-gray-500">
            Technical note: in the API and database, the System Admin role is
            named <code>TechnicalAdmin</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
