export function SystemAdminGuidePage() {
  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-4xl font-bold text-gray-900">System Admin Guide</h1>

      <div className="space-y-8">
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">Managing Departments</h2>
          <p className="text-gray-700">
            System admins can view all departments, manage their access states (LOCKED/OPEN),
            and configure department-level settings.
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">System-Wide Configuration</h2>
          <p className="text-gray-700 mb-4">
            Configure model settings and usage limits that apply across all departments:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>Model Identifier - Select which Claude model to use</li>
            <li>Temperature - Control model creativity (0-1)</li>
            <li>Max Tokens - Limit output length</li>
            <li>Usage Limits - Set message, debrief, upload, and draft limits</li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">Department Administration</h2>
          <p className="text-gray-700 mb-4">
            Each department has its own admin panel for:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>Managing users and their roles</li>
            <li>Approving access requests (for LOCKED departments)</li>
            <li>Setting department-level system prompts</li>
            <li>Viewing department analytics</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
