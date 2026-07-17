/**
 * Routes authenticated users to their role-specific dashboard.
 *
 * Student → writer dashboard
 * DepartmentAdmin → admin dashboard (scoped to departments)
 * TechnicalAdmin → system admin dashboard
 */
import { useAuth } from './AuthContext';

export function DashboardRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user || user.roles.length === 0) {
    return <div>Error: User has no roles</div>;
  }

  // Route by primary role (first in array)
  const primaryRole = user.roles[0];

  switch (primaryRole) {
    case 'Student':
      return <StudentDashboard />;
    case 'DepartmentAdmin':
      return <DepartmentAdminDashboard user={user} />;
    case 'TechnicalAdmin':
      return <SystemAdminDashboard />;
    default:
      return <div>Unknown role: {primaryRole}</div>;
  }
}

function StudentDashboard() {
  return (
    <div>
      <h1>My Documents</h1>
      <p>Student dashboard - writer interface</p>
      {/* TODO: Render student document list and editor */}
    </div>
  );
}

interface DepartmentAdminDashboardProps {
  user: { administeredDepartmentIds: string[] };
}

function DepartmentAdminDashboard({ user }: DepartmentAdminDashboardProps) {
  return (
    <div>
      <h1>Department Admin Console</h1>
      <p>Administering departments: {user.administeredDepartmentIds.join(', ')}</p>
      {/* TODO: Render document type config, user management, access grants */}
    </div>
  );
}

function SystemAdminDashboard() {
  return (
    <div>
      <h1>System Admin Console</h1>
      <p>System configuration and platform management</p>
      {/* TODO: Render system settings, all departments, user roles, analytics */}
    </div>
  );
}
