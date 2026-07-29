import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, LineChart } from 'lucide-react';

import { useActiveDepartment } from '@/features/department-admin/ActiveDepartmentContext';
import { listDocumentTypes } from '@/features/department-admin/departmentAdminApi';
import { EvaluationRubricSection } from './sections/EvaluationRubricSection';
import { AnalyticsSection } from './sections/AnalyticsSection';

type SidebarTab = 'evaluation-rubric' | 'analytics';

export function DocumentTypeDetailPage() {
  const navigate = useNavigate();
  const { documentTypeId } = useParams<{ documentTypeId: string }>();
  const { activeDepartment } = useActiveDepartment();
  const [activeTab, setActiveTab] = useState<SidebarTab>('evaluation-rubric');

  const { data: documentTypes } = useQuery({
    queryKey: ['dept-admin-document-types', activeDepartment?.id],
    queryFn: () =>
      activeDepartment?.id ? listDocumentTypes(activeDepartment.id) : Promise.resolve([]),
    enabled: !!activeDepartment?.id,
  });

  const documentType = documentTypes?.find((dt) => dt.id === documentTypeId) ?? {
    id: documentTypeId ?? '',
    name: documentTypeId ?? 'Loading...',
    departmentId: activeDepartment?.id ?? '',
    accessState: 'OPEN' as const,
    sizeLimitWords: null,
  };

  const sidebarItems: { id: SidebarTab; label: string; icon: React.ElementType }[] = [
    { id: 'evaluation-rubric', label: 'Evaluation Rubric', icon: BookOpen },
    { id: 'analytics', label: 'Analytics', icon: LineChart },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 bg-white p-6">
        <button
          type="button"
          onClick={() => navigate('/dept-admin')}
          className="mb-8 flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          Back
        </button>

        <div className="mb-8">
          <p className="text-xs font-semibold text-gray-500 uppercase">Document Type</p>
          <h2 className="mt-2 text-lg font-semibold text-gray-900">{documentType.name}</h2>
          {activeDepartment && (
            <p className="mt-1 text-xs text-gray-500">{activeDepartment.name}</p>
          )}
          <p className="mt-3 text-xs text-gray-500">
            Student access is controlled department-wide by a System Admin
            ({documentType.accessState === 'LOCKED' ? 'currently locked' : 'currently open'}).
          </p>
        </div>

        <nav className="space-y-2">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
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
            <AnalyticsSection documentTypeId={documentTypeId ?? ''} />
          )}
        </div>
      </div>
    </div>
  );
}
