/**
 * `<SystemUsersList>` — read-only list of all system-wide users with their roles
 * (task 19.4; Requirement 33.3).
 *
 * The Admin console views users/roles but does not assign them from here (actual
 * role assignment flows through the RBAC service from task 5.3). This component
 * is purely a display list.
 */
import { useSystemUsers } from '../useAdmin';

import type { HttpClient } from '@/services';

export interface SystemUsersListProps {
  readonly client?: HttpClient;
}

export function SystemUsersList({ client }: SystemUsersListProps) {
  const usersQuery = useSystemUsers(client);

  return (
    <section aria-labelledby="system-users-heading" className="flex flex-col gap-md">
      <h3
        id="system-users-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        System Users
      </h3>

      {usersQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading users…
        </p>
      )}

      {usersQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load users.
        </p>
      )}

      {usersQuery.data && usersQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">No users found.</p>
      )}

      {usersQuery.data && usersQuery.data.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Name
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Email
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {usersQuery.data.map((user) => (
              <tr key={user.id}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {user.firstName} {user.lastName}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {user.email}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {user.role}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
