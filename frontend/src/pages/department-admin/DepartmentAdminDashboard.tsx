import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

import { useActiveDepartment } from '@/features/department-admin/ActiveDepartmentContext';
import { listDocumentTypes, createDocumentType } from '@/features/department-admin/departmentAdminApi';
import { ApiError } from '@/services';

function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'message' in details) {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    if (error.status === 403) {
      return 'You do not have permission to create document types for this department.';
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Failed to create document type. Please try again.';
}

export function DepartmentAdminDashboard() {
  const navigate = useNavigate();
  const { activeDepartment, isLoading: deptLoading } = useActiveDepartment();
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDocType, setShowCreateDocType] = useState(false);
  const [newDocTypeName, setNewDocTypeName] = useState('');
  const queryClient = useQueryClient();

  const createDocTypeMutation = useMutation({
    mutationFn: (name: string) => createDocumentType(activeDepartment!.id, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['dept-admin-document-types', activeDepartment?.id],
      });
      setNewDocTypeName('');
      setShowCreateDocType(false);
    },
  });

  const { data: documentTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['dept-admin-document-types', activeDepartment?.id],
    queryFn: () =>
      activeDepartment?.id ? listDocumentTypes(activeDepartment.id) : Promise.resolve([]),
    enabled: !!activeDepartment?.id,
  });

  if (deptLoading || typesLoading) {
    return <div className="p-8">Loading...</div>;
  }

  if (!activeDepartment) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-900">No department assigned</h2>
          <p className="mt-2 text-sm text-amber-800">
            Your account does not administer any department yet. Ask a System Admin to
            appoint you as Department Admin for a department, then try again.
          </p>
        </div>
      </div>
    );
  }

  const filteredDocumentTypes = documentTypes.filter((docType) =>
    docType.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="p-8">
      {/* Department Banner */}
      <div className="mb-12 rounded-lg border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-lg font-semibold text-blue-900">Department Admin</h2>
        <p className="mt-2 text-sm text-blue-800">
          Managing document types for{' '}
          <span className="font-semibold">{activeDepartment.name}</span>
        </p>
      </div>

      {/* Document Types Section */}
      <div className="mb-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Document Types</h1>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowCreateDocType(true)}
              className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800"
            >
              Create new Document Type
            </button>
          </div>
        </div>

        <p className="mb-6 font-semibold text-gray-900">
          My Document Types ({documentTypes.length})
        </p>

        <div className="mb-6">
          <input
            type="text"
            placeholder="Search Document Types"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {filteredDocumentTypes.map((docType) => (
            <div
              key={docType.id}
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/dept-admin/document-type/${docType.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  navigate(`/dept-admin/document-type/${docType.id}`);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-xl font-semibold text-gray-900">{docType.name}</h3>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition hover:bg-gray-100 rounded"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="mb-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Department:</span>
                  <span className="font-semibold text-gray-900">{activeDepartment.name}</span>
                </div>
              </div>
              <button
                type="button"
                className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/dept-admin/document-type/${docType.id}`);
                }}
              >
                Manage Document Type
              </button>
            </div>
          ))}
        </div>
      </div>

      {showCreateDocType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Create Document Type</h2>
            <p className="mb-4 text-sm text-gray-600">
              New type will be created in <span className="font-semibold">{activeDepartment.name}</span>.
            </p>
            <input
              type="text"
              value={newDocTypeName}
              onChange={(e) => setNewDocTypeName(e.target.value)}
              placeholder="Document type name"
              className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            {createDocTypeMutation.isError && (
              <p className="mb-4 text-sm text-red-600">
                {createErrorMessage(createDocTypeMutation.error)}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreateDocType(false);
                  setNewDocTypeName('');
                  createDocTypeMutation.reset();
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newDocTypeName.trim() || createDocTypeMutation.isPending}
                onClick={() => createDocTypeMutation.mutate(newDocTypeName.trim())}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {createDocTypeMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
