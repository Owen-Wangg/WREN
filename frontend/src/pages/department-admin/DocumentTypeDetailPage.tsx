import { useEffect, useState } from 'react';
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
  const { activeDepartment, departments, setActiveDepartmentId, isLoading: deptLoading } =
    useActiveDepartment();
  const [activeTab, setActiveTab] = useState<SidebarTab>('evaluation-rubric');

  // Load types across allowed departments so deep links still resolve, then
  // refuse anything outside the actor's administered set (API also enforces).
  const { data: documentTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['dept-admin-document-types-all-allowed', departments.map((d) => d.id).join(',')],
    queryFn: async () => {
      if (departments.length === 0) return [];
      const lists = await Promise.all(departments.map((d) => listDocumentTypes(d.id)));
      return lists.flat();
    },
    enabled: departments.length > 0,
  });

  const documentType = documentTypes.find((dt) => dt.id === documentTypeId);
  const owningDepartment = documentType
    ? departments.find((d) => d.id === documentType.departmentId) ?? null
    : null;

  useEffect(() => {
    if (
      documentType &&
      owningDepartment &&
      activeDepartment &&
      documentType.departmentId !== activeDepartment.id
    ) {
      setActiveDepartmentId(documentType.departmentId);
    }
  }, [documentType, owningDepartment, activeDepartment, setActiveDepartmentId]);

  const sidebarItems: { id: SidebarTab; label: string; icon: React.ElementType }[] = [
    { id: 'evaluation-rubric', label: 'Evaluation Rubric', icon: BookOpen },
    { id: 'analytics', label: 'Analytics', icon: LineChart },
  ];

  if (deptLoading || typesLoading) {
    return <div className="p-8 text-sm text-gray-600">Loading…</div>;
  }

  if (!documentType || !owningDepartment) {
    return (
      <div className="flex min-h-screen items-start justify-center bg-gray-50 p-8">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-900">Document type not available</h2>
          <p className="mt-2 text-sm text-amber-800">
            This document type is not in a department you administer, or it does not exist.
          </p>
          <button
            type="button"
            onClick={() => navigate('/dept-admin')}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

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
          <p className="mt-1 text-xs text-gray-500">{owningDepartment.name}</p>
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
              documentTypeId={documentType.id}
              documentTypeName={documentType.name}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsSection documentTypeId={documentType.id} />
          )}
        </div>
      </div>
    </div>
  );
}
