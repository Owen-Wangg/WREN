import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import type { DepartmentEnrollment } from '@wren/types';

import {
  departmentRosterQueryKey,
  listDepartmentEnrollments,
  removeDepartmentEnrollment,
} from '../systemAdminApi';

const ROSTER_PAGE_SIZE = 20;

type StatusFilter = 'all' | 'enrolled' | 'pending';

interface DepartmentRosterSectionProps {
  readonly departmentId: string;
  readonly departmentName?: string;
  /** Opens the CSV import dialog. */
  readonly onImport: () => void;
}

function displayName(entry: DepartmentEnrollment): string | null {
  const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

/**
 * The Department's student roster: everyone enrolled by CSV import, whether
 * they already have an account or are waiting to sign up. Removing a student
 * here takes away the access their enrollment gave them.
 */
export function DepartmentRosterSection({
  departmentId,
  departmentName,
  onImport,
}: DepartmentRosterSectionProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [offset, setOffset] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<DepartmentEnrollment | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const rosterQuery = useQuery({
    queryKey: [...departmentRosterQueryKey(departmentId), debouncedSearch, status, offset],
    queryFn: () =>
      listDepartmentEnrollments(departmentId, {
        q: debouncedSearch || undefined,
        status: status === 'all' ? undefined : status,
        limit: ROSTER_PAGE_SIZE,
        offset,
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (entry: DepartmentEnrollment) => removeDepartmentEnrollment(departmentId, entry.id),
    onSuccess: (_data, entry) => {
      setStatusMessage(`${entry.email} was removed from the roster.`);
      setPendingRemoval(null);
      if ((rosterQuery.data?.items.length ?? 0) === 1 && offset > 0) {
        setOffset(Math.max(0, offset - ROSTER_PAGE_SIZE));
      }
      void queryClient.invalidateQueries({ queryKey: departmentRosterQueryKey(departmentId) });
      void queryClient.invalidateQueries({ queryKey: ['department-users', departmentId] });
      void queryClient.invalidateQueries({
        queryKey: ['department-visibility-grants', departmentId],
      });
    },
  });

  const data = rosterQuery.data;

  return (
    <section
      aria-labelledby="student-roster-heading"
      className="mb-8 rounded-lg border border-gray-200 bg-white p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="student-roster-heading" className="text-xl font-semibold text-gray-900">
            Student roster
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Students enrolled by email. Upload an updated CSV to add students or replace the whole
            list, or remove students one at a time.
          </p>
        </div>
        <button
          type="button"
          onClick={onImport}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          <Upload size={16} />
          Import CSV
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="search"
          aria-label="Search the roster"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setStatusMessage(null);
          }}
          placeholder="Search by email or name"
          className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
            setOffset(0);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        >
          <option value="all">All students</option>
          <option value="enrolled">Enrolled</option>
          <option value="pending">Waiting for sign-up</option>
        </select>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200" aria-busy={rosterQuery.isFetching}>
        {rosterQuery.isLoading && (
          <p role="status" className="p-4 text-sm text-gray-600">Loading roster…</p>
        )}
        {rosterQuery.isError && (
          <div className="p-4 text-sm">
            <p role="alert" className="text-red-600">Could not load the roster.</p>
            <button
              type="button"
              onClick={() => void rosterQuery.refetch()}
              className="mt-2 font-semibold text-gray-900 underline"
            >
              Retry
            </button>
          </div>
        )}
        {data && data.items.length === 0 && (
          <p className="p-4 text-sm text-gray-500">
            {debouncedSearch || status !== 'all'
              ? 'No students on the roster match this search.'
              : 'No students on the roster yet. Import a CSV to enroll students.'}
          </p>
        )}
        {data?.items.map((entry) => {
          const name = displayName(entry);
          return (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 border-b border-gray-100 p-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{name ?? entry.email}</p>
                {name && <p className="truncate text-xs text-gray-500">{entry.email}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    entry.status === 'enrolled'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {entry.status === 'enrolled' ? 'Enrolled' : 'Waiting for sign-up'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStatusMessage(null);
                    removeMutation.reset();
                    setPendingRemoval(entry);
                  }}
                  aria-label={`Remove ${entry.email} from the roster`}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {data && data.total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-600">
          <span>
            Showing {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((current) => Math.max(0, current - ROSTER_PAGE_SIZE))}
              disabled={offset === 0 || rosterQuery.isFetching}
              className="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset((current) => current + ROSTER_PAGE_SIZE)}
              disabled={offset + data.items.length >= data.total || rosterQuery.isFetching}
              className="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {statusMessage && (
        <p role="status" className="mt-2 text-sm text-green-700">{statusMessage}</p>
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
              Remove from roster?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-gray-600">
              <strong>{pendingRemoval?.email}</strong>{' '}
              {pendingRemoval?.status === 'enrolled'
                ? `will lose access to ${departmentName ?? 'this department'}: it is hidden from them if visibility is limited, and they can no longer submit to its document types while it is locked. Their existing documents are kept.`
                : 'will no longer be enrolled automatically when they sign up.'}
            </Dialog.Description>
            {removeMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                Failed to remove this student. Please try again.
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
    </section>
  );
}
