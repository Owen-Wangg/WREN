/**
 * `<OrganizationsList>` — lists Organizations with actions to create, remove,
 * toggle OPEN/LOCKED, and assign Org Owner (task 19.4; Requirement 33.2).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  createOrganizationInputSchema,
  type CreateOrganizationInput,
} from '../adminSchemas';
import {
  useAdminOrganizations,
  useCreateOrganization,
  useRemoveOrganization,
  useSetOrganizationAccessState,
  useAssignOrgOwner,
} from '../useAdmin';

import type { HttpClient } from '@/services';

export interface OrganizationsListProps {
  readonly client?: HttpClient;
}

export function OrganizationsList({ client }: OrganizationsListProps) {
  const orgsQuery = useAdminOrganizations(client);
  const createMutation = useCreateOrganization(client);
  const removeMutation = useRemoveOrganization(client);
  const accessStateMutation = useSetOrganizationAccessState(client);
  const assignOwnerMutation = useAssignOrgOwner(client);

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [assignOwnerOrgId, setAssignOwnerOrgId] = useState<string | null>(null);
  const [ownerUserId, setOwnerUserId] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationInputSchema),
    defaultValues: { name: '' },
  });

  const onCreateOrg = (values: CreateOrganizationInput) => {
    createMutation.mutate(values, { onSuccess: () => reset() });
  };

  const handleRemove = (organizationId: string) => {
    removeMutation.mutate(organizationId, {
      onSuccess: () => setConfirmRemoveId(null),
    });
  };

  const handleAssignOwner = () => {
    if (assignOwnerOrgId && ownerUserId.trim()) {
      assignOwnerMutation.mutate(
        { organizationId: assignOwnerOrgId, userId: ownerUserId.trim() },
        {
          onSuccess: () => {
            setAssignOwnerOrgId(null);
            setOwnerUserId('');
          },
        },
      );
    }
  };

  return (
    <section aria-labelledby="organizations-heading" className="flex flex-col gap-md">
      <h3
        id="organizations-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Organizations
      </h3>

      {orgsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading organizations…
        </p>
      )}

      {orgsQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load organizations.
        </p>
      )}

      {orgsQuery.data && orgsQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No organizations yet. Create one below.
        </p>
      )}

      {orgsQuery.data && orgsQuery.data.length > 0 && (
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
                Access State
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Owner
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {orgsQuery.data.map((org) => (
              <tr key={org.id}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {org.name}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {org.accessState}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {org.ownerUserId ?? '—'}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall">
                  <div className="flex flex-wrap gap-sm">
                    <button
                      type="button"
                      onClick={() =>
                        accessStateMutation.mutate({
                          organizationId: org.id,
                          accessState:
                            org.accessState === 'OPEN' ? 'LOCKED' : 'OPEN',
                        })
                      }
                      className="text-bodySmall font-sans font-medium text-text-primary underline"
                    >
                      {org.accessState === 'OPEN' ? 'Lock' : 'Unlock'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignOwnerOrgId(org.id)}
                      className="text-bodySmall font-sans font-medium text-text-primary underline"
                    >
                      Assign Owner
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(org.id)}
                      className="text-bodySmall font-sans font-medium text-signal-critical underline"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Confirm remove */}
      {confirmRemoveId && (
        <div
          role="alertdialog"
          aria-label="Confirm removal"
          className="flex flex-col gap-sm rounded-md border border-border-strong bg-surface-primary p-md"
        >
          <p className="text-bodySmall text-text-primary">
            Remove this organization? This action cannot be undone.
          </p>
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={() => handleRemove(confirmRemoveId)}
              disabled={removeMutation.isPending}
              className="rounded-md bg-signal-critical px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
            >
              {removeMutation.isPending ? 'Removing…' : 'Confirm Remove'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemoveId(null)}
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Assign Org Owner */}
      {assignOwnerOrgId && (
        <div className="flex flex-col gap-sm rounded-md border border-border-strong bg-surface-primary p-md">
          <label htmlFor="owner-user-id" className="text-caption text-text-secondary">
            User ID of new Org Owner
          </label>
          <input
            id="owner-user-id"
            type="text"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            placeholder="user-id"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
          />
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={handleAssignOwner}
              disabled={assignOwnerMutation.isPending || !ownerUserId.trim()}
              className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
            >
              {assignOwnerMutation.isPending ? 'Assigning…' : 'Assign'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAssignOwnerOrgId(null);
                setOwnerUserId('');
              }}
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create organization form */}
      <form
        onSubmit={handleSubmit(onCreateOrg)}
        className="flex flex-wrap items-end gap-sm"
        aria-label="Create organization"
      >
        <div className="flex flex-col gap-xs">
          <label htmlFor="new-org-name" className="text-caption text-text-secondary">
            New organization
          </label>
          <input
            id="new-org-name"
            type="text"
            placeholder="Organization name"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            {...register('name')}
          />
          {errors.name && (
            <p className="text-caption text-signal-critical">{errors.name.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>
    </section>
  );
}
