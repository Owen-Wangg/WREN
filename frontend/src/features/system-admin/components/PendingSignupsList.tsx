import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepartmentEnrollment } from '@wren/types';

import {
  departmentRosterQueryKey,
  listDepartmentEnrollments,
  removeDepartmentEnrollment,
} from '../systemAdminApi';

const PAGE_SIZE = 20;

interface PendingSignupsListProps {
  readonly departmentId: string;
}

/**
 * Emails added to Permitted users (by CSV) that have no WREN account yet. Each
 * becomes a permitted user automatically the first time someone signs in with
 * that email. Renders nothing while there are none.
 */
export function PendingSignupsList({ departmentId }: PendingSignupsListProps) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<DepartmentEnrollment | null>(null);

  const pendingQuery = useQuery({
    queryKey: [...departmentRosterQueryKey(departmentId), 'pending', offset],
    queryFn: () =>
      listDepartmentEnrollments(departmentId, { status: 'pending', limit: PAGE_SIZE, offset }),
  });

  const removeMutation = useMutation({
    mutationFn: (entry: DepartmentEnrollment) => removeDepartmentEnrollment(departmentId, entry.id),
    onSuccess: () => {
      setPendingRemoval(null);
      if ((pendingQuery.data?.items.length ?? 0) === 1 && offset > 0) {
        setOffset(Math.max(0, offset - PAGE_SIZE));
      }
      void queryClient.invalidateQueries({ queryKey: departmentRosterQueryKey(departmentId) });
    },
  });

  const data = pendingQuery.data;
  if (!data || data.total === 0) return null;

  return (
    <div className="mt-6">
      <h4 className="text-sm font-semibold text-gray-900">
        Waiting for sign-up ({data.total})
      </h4>
      <p className="mt-1 text-xs text-gray-500">
        No WREN account uses these emails yet. They become permitted users automatically the
        first time they sign in.
      </p>
      <div className="mt-2 rounded-lg border border-gray-200" aria-busy={pendingQuery.isFetching}>
        {data.items.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between gap-3 border-b border-gray-100 p-3 last:border-b-0"
          >
            <p className="min-w-0 truncate text-sm text-gray-900">{entry.email}</p>
            <button
              type="button"
              onClick={() => {
                removeMutation.reset();
                setPendingRemoval(entry);
              }}
              aria-label={`Remove ${entry.email} from Permitted users`}
              className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {data.total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-600">
          <span>
            Showing {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              disabled={offset === 0 || pendingQuery.isFetching}
              className="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              disabled={offset + data.items.length >= data.total || pendingQuery.isFetching}
              className="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <Dialog.Root
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (removeMutation.isPending) return;
          if (!open) setPendingRemoval(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl focus:outline-none">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Remove pending email?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-gray-600">
              <strong>{pendingRemoval?.email}</strong> will not become a permitted user when they
              sign up.
            </Dialog.Description>
            {removeMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                Failed to remove this email. Please try again.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingRemoval(null)}
                disabled={removeMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => pendingRemoval && removeMutation.mutate(pendingRemoval)}
                disabled={removeMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removeMutation.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
