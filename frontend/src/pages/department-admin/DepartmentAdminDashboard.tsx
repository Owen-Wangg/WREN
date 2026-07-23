import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

import { useAuth } from '@/features/auth/AuthContext';
import { listDepartments, listDocumentTypes, createDocumentType } from '@/features/department-admin/departmentAdminApi';
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
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: allDepartments = [], isLoading: deptLoading } = useQuery({
    queryKey: ['dept-admin-departments'],
    queryFn: () => listDepartments(),
  });

  const isTechnicalAdmin = user?.roles.includes('TechnicalAdmin') ?? false;
  const administeredIds = user?.administeredDepartmentIds ?? [];

  // DepartmentAdmins only manage their appointed departments; System Admins can
  // bootstrap catalog entries for any department.
  const departments = useMemo(() => {
    if (isTechnicalAdmin) return allDepartments;
    if (administeredIds.length === 0) return [];
    return allDepartments.filter((d) => administeredIds.includes(d.id));
  }, [allDepartments, administeredIds, isTechnicalAdmin]);

  const currentDepartment = departments[0];
  const [showCreateDocType, setShowCreateDocType] = useState(false);
  const [newDocTypeName, setNewDocTypeName] = useState('');
  const queryClient = useQueryClient();

  const createDocTypeMutation = useMutation({
    mutationFn: (name: string) => createDocumentType(currentDepartment!.id, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dept-admin-document-types', currentDepartment?.id] });
      setNewDocTypeName('');
      setShowCreateDocType(false);
    },
  });

  const { data: documentTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['dept-admin-document-types', currentDepartment?.id],
    queryFn: () => currentDepartment?.id ? listDocumentTypes(currentDepartment.id) : Promise.resolve([]),
    enabled: !!currentDepartment?.id,
  });

  if (deptLoading || typesLoading) {
    return <div className="p-8">Loading...</div>;
  }

  if (!currentDepartment) {
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
    docType.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8">
      {/* Department Banner */}
      <div className="mb-12 rounded-lg border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-lg font-semibold text-blue-900">Department Admin</h2>
        <p className="mt-2 text-sm text-blue-800">
          Managing document types for <span className="font-semibold">{currentDepartment?.name}</span>
        </p>
      </div>

      {/* Document Types Section */}
      <div className="mb-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Document Types</h1>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCreateDocType(true)}
              className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800"
            >
              Create new Document Type
            </button>
          </div>
        </div>

        <p className="mb-6 font-semibold text-gray-900">My Document Types ({documentTypes.length})</p>

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
            >
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-xl font-semibold text-gray-900">{docType.name}</h3>
                <button
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
                  <span className="font-semibold text-gray-900">{currentDepartment?.name}</span>
                </div>
              </div>
              <button
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

        {filteredDocumentTypes.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-gray-600">No document types found.</p>
            <button
              onClick={() => setShowCreateDocType(true)}
              className="mt-4 rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800"
            >
              Create your first Document Type
            </button>
          </div>
        )}
      </div>

      {/* Create Document Type Dialog */}
      {showCreateDocType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-gray-900">Create New Document Type</h2>
            <p className="mb-4 text-sm text-gray-600">
              Adding to <span className="font-semibold">{currentDepartment?.name}</span>
            </p>
            <label className="mb-1 block text-sm font-semibold text-gray-900">Document Type Name</label>
            <input
              type="text"
              value={newDocTypeName}
              onChange={(e) => setNewDocTypeName(e.target.value)}
              placeholder="e.g. Legal Memorandum, Factum, Case Brief"
              className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDocTypeName.trim()) createDocTypeMutation.mutate(newDocTypeName.trim());
              }}
              autoFocus
            />
            {createDocTypeMutation.isError && (
              <p className="mb-3 text-sm text-red-600">
                {createErrorMessage(createDocTypeMutation.error)}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowCreateDocType(false); setNewDocTypeName(''); }}
                className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { if (newDocTypeName.trim()) createDocTypeMutation.mutate(newDocTypeName.trim()); }}
                disabled={!newDocTypeName.trim() || createDocTypeMutation.isPending}
                className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
