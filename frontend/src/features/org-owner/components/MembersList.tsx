/**
 * `<MembersList>` — lists org members and provides Add Member + Assign Field
 * Expert actions (task 19.3; Requirements 34.1, 34.2, 34.4).
 *
 * Shows each member's firstName, lastName, email, role, and
 * assignedWritingTypeIds. "Add Member" takes an email. "Assign Field Expert"
 * opens a Writing Type multi-select filtered to the org's own types only
 * (Requirement 34.2/34.4 — no platform-wide assignment is expressible).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  addMemberInputSchema,
  assignFieldExpertInputSchema,
  type AddMemberInput,
  type AssignFieldExpertInput,
} from '../orgOwnerTypes';
import {
  useOrgMembers,
  useOrgWritingTypes,
  useAddMember,
  useAssignFieldExpert,
} from '../useOrgOwner';

import type { HttpClient } from '@/services';

export interface MembersListProps {
  readonly organizationId: string;
  readonly client?: HttpClient;
}

export function MembersList({ organizationId, client }: MembersListProps) {
  const membersQuery = useOrgMembers(organizationId, client);
  const writingTypesQuery = useOrgWritingTypes(organizationId, client);
  const addMemberMutation = useAddMember(organizationId, client);
  const assignMutation = useAssignFieldExpert(organizationId, client);

  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);

  /* Add member form */
  const {
    register: registerAdd,
    handleSubmit: handleSubmitAdd,
    reset: resetAdd,
    formState: { errors: addErrors },
  } = useForm<AddMemberInput>({
    resolver: zodResolver(addMemberInputSchema),
    defaultValues: { organizationId, email: '' },
  });

  const onAddMember = (values: AddMemberInput) => {
    addMemberMutation.mutate(values, { onSuccess: () => resetAdd() });
  };

  /* Assign field expert form */
  const {
    register: registerAssign,
    handleSubmit: handleSubmitAssign,
    reset: resetAssign,
    formState: { errors: assignErrors },
  } = useForm<AssignFieldExpertInput>({
    resolver: zodResolver(assignFieldExpertInputSchema),
    defaultValues: { organizationId, userId: '', writingTypeIds: [] },
  });

  const onAssignFieldExpert = (values: AssignFieldExpertInput) => {
    assignMutation.mutate(values, {
      onSuccess: () => {
        resetAssign();
        setAssigningUserId(null);
      },
    });
  };

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-md">
      <h3
        id="members-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Members
      </h3>

      {membersQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading members…
        </p>
      )}

      {membersQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load members.
        </p>
      )}

      {membersQuery.data && membersQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No members yet. Add one below.
        </p>
      )}

      {membersQuery.data && membersQuery.data.length > 0 && (
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
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {membersQuery.data.map((member) => (
              <tr key={member.userId}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {member.firstName} {member.lastName}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {member.email}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {member.role}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall">
                  <button
                    type="button"
                    onClick={() => setAssigningUserId(member.userId)}
                    className="text-bodySmall font-sans font-medium text-text-primary underline"
                  >
                    Assign Field Expert
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Assign Field Expert dialog (inline panel) */}
      {assigningUserId && (
        <form
          onSubmit={handleSubmitAssign(onAssignFieldExpert)}
          className="flex flex-col gap-sm rounded-md border border-border-strong bg-surface-primary p-md"
          aria-label="Assign field expert"
        >
          <p className="text-bodySmall text-text-primary">
            Assign Writing Types to member as Field Expert
          </p>
          <input type="hidden" value={organizationId} {...registerAssign('organizationId')} />
          <input type="hidden" value={assigningUserId} {...registerAssign('userId')} />
          <fieldset className="flex flex-col gap-xs">
            <legend className="text-caption text-text-secondary">
              Writing Types (org-scoped)
            </legend>
            {(writingTypesQuery.data ?? []).map((wt) => (
              <label key={wt.id} className="flex items-center gap-xs text-bodySmall text-text-primary">
                <input
                  type="checkbox"
                  value={wt.id}
                  className="h-4 w-4 rounded border border-border-strong"
                  {...registerAssign('writingTypeIds')}
                />
                {wt.name}
              </label>
            ))}
          </fieldset>
          {assignErrors.writingTypeIds && (
            <p className="text-caption text-signal-critical">
              {assignErrors.writingTypeIds.message}
            </p>
          )}
          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={assignMutation.isPending}
              className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
            >
              {assignMutation.isPending ? 'Assigning…' : 'Assign'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAssigningUserId(null);
                resetAssign();
              }}
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Add member form */}
      <form
        onSubmit={handleSubmitAdd(onAddMember)}
        className="flex flex-wrap items-end gap-sm"
        aria-label="Add member"
      >
        <div className="flex flex-col gap-xs">
          <label htmlFor="add-member-email" className="text-caption text-text-secondary">
            Add member by email
          </label>
          <input
            id="add-member-email"
            type="email"
            placeholder="user@example.com"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            {...registerAdd('email')}
          />
          {addErrors.email && (
            <p className="text-caption text-signal-critical">
              {addErrors.email.message}
            </p>
          )}
        </div>
        <input type="hidden" {...registerAdd('organizationId')} />
        <button
          type="submit"
          disabled={addMemberMutation.isPending}
          className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
        >
          {addMemberMutation.isPending ? 'Adding…' : 'Add Member'}
        </button>
      </form>
    </section>
  );
}
