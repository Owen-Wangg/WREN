import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Trash2 } from 'lucide-react';

import { useActiveDepartment } from '@/features/department-admin/ActiveDepartmentContext';
import { useAuth } from '@/features/auth/AuthContext';
import {
  listDocumentTypes,
  createDocumentType,
  deleteDocumentType,
  updateDepartmentAskWrenPrompt,
  updateDepartmentPrompt,
} from '@/features/department-admin/departmentAdminApi';
import { DepartmentPromptEditor } from '@/features/department-admin/DepartmentPromptEditor';
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

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'message' in details) {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    if (error.status === 409) {
      return 'This document type cannot be deleted while documents still use it. Delete those documents first.';
    }
    if (error.status === 403) {
      return 'You do not have permission to delete this document type.';
    }
  }
  if (error instanceof Error) return error.message;
  return 'Failed to delete document type. Please try again.';
}

type PromptTabId = 'department' | 'ask-wren';

const PROMPT_TABS: ReadonlyArray<{ id: PromptTabId; label: string }> = [
  { id: 'department', label: 'Department Prompt' },
  { id: 'ask-wren', label: 'Ask WREN Prompt' },
];

function promptErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'message' in details) {
      const message = (details as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (error.status === 403) {
      return 'You are not appointed as Department Admin for this department.';
    }
  }
  if (error instanceof Error) return error.message;
  return 'Failed to save the Ask Wren prompt. Please try again.';
}

export function DepartmentAdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    activeDepartment,
    departments,
    setActiveDepartmentId,
    isLoading: deptLoading,
  } = useActiveDepartment();
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDocType, setShowCreateDocType] = useState(false);
  const [newDocTypeName, setNewDocTypeName] = useState('');
  const [docTypeToDelete, setDocTypeToDelete] = useState<{ id: string; name: string } | null>(null);
  const [askWrenPrompt, setAskWrenPrompt] = useState('');
  const [activePromptTab, setActivePromptTab] = useState<PromptTabId>('department');
  const [promptsExpanded, setPromptsExpanded] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    setAskWrenPrompt(activeDepartment?.askWrenPrompt ?? '');
  }, [activeDepartment?.id, activeDepartment?.askWrenPrompt]);

  const askWrenPromptMutation = useMutation({
    mutationFn: (prompt: string) =>
      updateDepartmentAskWrenPrompt(
        activeDepartment!.id,
        prompt.trim() ? prompt : null,
      ),
    onSuccess: (updatedDepartment) => {
      setAskWrenPrompt(updatedDepartment.askWrenPrompt ?? '');
      void queryClient.invalidateQueries({ queryKey: ['dept-admin-departments'] });
    },
  });

  const deleteDocTypeMutation = useMutation({
    mutationFn: (documentTypeId: string) => deleteDocumentType(documentTypeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['dept-admin-document-types', activeDepartment?.id],
      });
      setDocTypeToDelete(null);
    },
  });

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

  // Both department prompts (Feedback-Engine + Ask Wren) are shown only to a
  // DepartmentAdmin appointed to this department. TechnicalAdmins edit any
  // department's prompts from the System Admin area. The backend re-checks
  // scope on save.
  const canManageDepartmentPrompts = Boolean(
    user?.roles.includes('DepartmentAdmin') &&
    user.administeredDepartmentIds.includes(activeDepartment.id),
  );
  const filteredDocumentTypes = documentTypes.filter((docType) =>
    docType.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const canSwitchDepartments = departments.length > 1;

  return (
    <div className="p-8">
      {/* Department Banner */}
      <div className="mb-12 rounded-lg border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-lg font-semibold text-blue-900">Department Admin</h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-blue-800">
          <span>Managing document types for</span>
          {canSwitchDepartments ? (
            <label className="relative inline-flex items-center">
              <span className="sr-only">Active department</span>
              <select
                value={activeDepartment.id}
                onChange={(e) => setActiveDepartmentId(e.target.value)}
                className="cursor-pointer appearance-none border-0 border-b border-blue-400/80 bg-transparent py-0 pr-5 font-semibold text-blue-900 underline decoration-blue-400/70 underline-offset-4 transition hover:border-blue-600 hover:text-blue-950 hover:decoration-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-50"
                aria-label="Select department to manage"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                strokeWidth={2.5}
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-blue-700"
              />
            </label>
          ) : (
            <span className="font-semibold text-blue-900">{activeDepartment.name}</span>
          )}
        </p>
      </div>

      {/* Department prompts — one tabbed card instead of two stacked editors */}
      {canManageDepartmentPrompts && (
        <section
          aria-labelledby="department-prompts-heading"
          className="mb-12 max-w-4xl rounded-lg border border-gray-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
            <h2 id="department-prompts-heading" className="text-lg font-semibold text-gray-900">
              Prompts
            </h2>
            <div className="flex items-center gap-2">
              <div
                role="tablist"
                aria-label="Department prompts"
                className="inline-flex rounded-lg bg-gray-100 p-1"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const index = PROMPT_TABS.findIndex((t) => t.id === activePromptTab);
                  const delta = event.key === 'ArrowRight' ? 1 : -1;
                  const next = PROMPT_TABS[(index + delta + PROMPT_TABS.length) % PROMPT_TABS.length]!;
                  setActivePromptTab(next.id);
                  setPromptsExpanded(true);
                  document.getElementById(`prompt-tab-${next.id}`)?.focus();
                }}
              >
                {PROMPT_TABS.map((tab) => {
                  const selected = activePromptTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      id={`prompt-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`prompt-panel-${tab.id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        setActivePromptTab(tab.id);
                        setPromptsExpanded(true);
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                        selected && promptsExpanded
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPromptsExpanded((open) => !open)}
                aria-expanded={promptsExpanded}
                aria-controls={`prompt-panel-${activePromptTab}`}
                aria-label={promptsExpanded ? 'Collapse prompts' : 'Expand prompts'}
                className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
              >
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className={`transition-transform ${promptsExpanded ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </div>

          {/* Panels stay mounted (hidden) so unsaved edits survive tab switches. */}
          <div
            id="prompt-panel-department"
            role="tabpanel"
            aria-labelledby="prompt-tab-department"
            hidden={!promptsExpanded || activePromptTab !== 'department'}
            className="p-6"
          >
            <h3 className="mb-4 text-xl font-bold text-gray-900">Department Prompt</h3>
            <DepartmentPromptEditor
              departmentId={activeDepartment.id}
              prompt={activeDepartment.prompt}
              save={updateDepartmentPrompt}
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: ['dept-admin-departments'] });
              }}
            />
          </div>

          <div
            id="prompt-panel-ask-wren"
            role="tabpanel"
            aria-labelledby="prompt-tab-ask-wren"
            hidden={!promptsExpanded || activePromptTab !== 'ask-wren'}
            className="p-6"
          >
        <h3 className="text-xl font-bold text-gray-900">Ask Wren Prompt</h3>
        <p className="mt-2 text-sm text-gray-600">
          Add department-specific context for Ask Wren's Socratic coaching questions across
          every document type in {activeDepartment.name}. Core coaching safeguards still apply.
        </p>
        <label
          htmlFor="department-ask-wren-prompt"
          className="mt-5 block text-sm font-semibold text-gray-900"
        >
          Ask Wren coaching context
        </label>
        <textarea
          id="department-ask-wren-prompt"
          value={askWrenPrompt}
          onChange={(event) => {
            setAskWrenPrompt(event.target.value);
            askWrenPromptMutation.reset();
          }}
          placeholder="e.g. Law students writing legal memoranda. Encourage IRAC structure and precise use of authority."
          className="mt-2 h-40 w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => askWrenPromptMutation.mutate(askWrenPrompt)}
            disabled={askWrenPromptMutation.isPending}
            className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {askWrenPromptMutation.isPending ? 'Saving…' : 'Save Ask Wren Prompt'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAskWrenPrompt('');
              askWrenPromptMutation.reset();
            }}
            disabled={askWrenPromptMutation.isPending}
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </button>
          {askWrenPromptMutation.isSuccess && (
            <span role="status" className="text-sm font-semibold text-green-700">
              Saved successfully!
            </span>
          )}
        </div>
        {askWrenPromptMutation.isError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {promptErrorMessage(askWrenPromptMutation.error)}
          </p>
        )}
          </div>
        </section>
      )}

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
                    setDocTypeToDelete({ id: docType.id, name: docType.name });
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

      {docTypeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Delete Document Type</h2>
            <p className="mb-4 text-sm text-gray-600">
              Are you sure you want to delete{' '}
              <span className="font-semibold">{docTypeToDelete.name}</span>? This action cannot be
              undone. Types that still have submitted documents cannot be deleted until those
              documents are removed.
            </p>
            {deleteDocTypeMutation.isError && (
              <p className="mb-4 text-sm text-red-600">
                {deleteErrorMessage(deleteDocTypeMutation.error)}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDocTypeToDelete(null);
                  deleteDocTypeMutation.reset();
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteDocTypeMutation.isPending}
                onClick={() => deleteDocTypeMutation.mutate(docTypeToDelete.id)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteDocTypeMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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
