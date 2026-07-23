import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, LineChart } from 'lucide-react';

import {
  listDocumentTypes,
  setDocumentTypeAccessState,
} from '@/features/department-admin/departmentAdminApi';
import { EvaluationRubricSection } from './sections/EvaluationRubricSection';
import { AnalyticsSection } from './sections/AnalyticsSection';

type SidebarTab = 'evaluation-rubric' | 'analytics';

export function DocumentTypeDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { documentTypeId } = useParams<{ documentTypeId: string }>();
  const [activeTab, setActiveTab] = useState<SidebarTab>('evaluation-rubric');
  const [accessError, setAccessError] = useState<string | null>(null);

  const { data: documentTypes } = useQuery({
    queryKey: ['document-types'],
    queryFn: () => listDocumentTypes(),
  });

  const documentType = documentTypes?.find((dt) => dt.id === documentTypeId) ?? {
    id: documentTypeId ?? '',
    name: documentTypeId ?? 'Loading...',
    departmentId: '',
    accessState: 'LOCKED' as const,
    sizeLimitWords: null,
  };

  const accessMutation = useMutation({
    mutationFn: (accessState: 'OPEN' | 'LOCKED') =>
      setDocumentTypeAccessState(documentTypeId!, accessState),
    onSuccess: async () => {
      setAccessError(null);
      await queryClient.invalidateQueries({ queryKey: ['document-types'] });
      await queryClient.invalidateQueries({ queryKey: ['dept-admin-document-types'] });
    },
    onError: (err: unknown) => {
      setAccessError(err instanceof Error ? err.message : 'Failed to update access state');
    },
  });

  const isLocked = documentType.accessState === 'LOCKED';

  const sidebarItems: { id: SidebarTab; label: string; icon: React.ElementType }[] = [
    { id: 'evaluation-rubric', label: 'Evaluation Rubric', icon: BookOpen },
    { id: 'analytics', label: 'Analytics', icon: LineChart },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 bg-white p-6">
        <button
          onClick={() => navigate('/dept-admin')}
          className="mb-8 flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          Back
        </button>

        <div className="mb-8">
          <p className="text-xs font-semibold text-gray-500 uppercase">Document Type</p>
          <h2 className="mt-2 text-lg font-semibold text-gray-900">{documentType.name}</h2>
          <div className="mt-4 rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">Student access</p>
                <p className="text-xs text-gray-500">
                  {isLocked
                    ? 'Locked — students need a grant or this type opened'
                    : 'Open — any student in the department can create documents'}
                </p>
              </div>
              <button
                type="button"
                disabled={!documentTypeId || accessMutation.isPending}
                onClick={() => accessMutation.mutate(isLocked ? 'OPEN' : 'LOCKED')}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  isLocked
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                {accessMutation.isPending ? 'Saving…' : isLocked ? 'Open' : 'Lock'}
              </button>
            </div>
            {accessError && <p className="mt-2 text-xs text-red-600">{accessError}</p>}
          </div>
        </div>

        <nav className="space-y-2">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeTab === item.id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          {activeTab === 'evaluation-rubric' && (
            <EvaluationRubricSection
              documentTypeId={documentTypeId ?? ''}
              documentTypeName={documentType.name}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsSection
              documentTypeId={documentTypeId ?? ''}
            />
          )}
        </div>
      </div>
    </div>
  );
}
