import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Settings, LineChart, CheckCircle2 } from 'lucide-react';

import { listDocumentTypes, listErrorCategories } from '@/features/department-admin/departmentAdminApi';
import { FeedbackTypeSection } from './sections/FeedbackTypeSection';
import { ManagePromptSection } from './sections/ManagePromptSection';
import { AnalyticsSection } from './sections/AnalyticsSection';

type SidebarTab = 'feedback-types' | 'manage-prompt' | 'analytics';

export function DocumentTypeDetailPage() {
  const navigate = useNavigate();
  const { documentTypeId } = useParams<{ documentTypeId: string }>();
  const [activeTab, setActiveTab] = useState<SidebarTab>('feedback-types');

  const { data: documentTypes } = useQuery({
    queryKey: ['document-types'],
    queryFn: () => listDocumentTypes(),
  });

  const documentType = documentTypes?.find((dt) => dt.id === documentTypeId) ?? {
    id: documentTypeId ?? '',
    name: documentTypeId ?? 'Loading...',
    departmentId: '',
  };

  const { data: errorCategories = [] } = useQuery({
    queryKey: ['error-categories', documentTypeId],
    queryFn: () => listErrorCategories(documentTypeId!),
    enabled: !!documentTypeId,
  });

  const feedbackCategories = errorCategories.map((c) => ({
    id: c.id,
    title: c.name,
    description: '',
  }));

  const sidebarItems = [
    { id: 'feedback-types' as const, label: 'Feedback Types', icon: CheckCircle2 },
    { id: 'manage-prompt' as const, label: 'Manage Prompt', icon: Settings },
    { id: 'analytics' as const, label: 'Analytics', icon: LineChart },
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
          {activeTab === 'feedback-types' && (
            <FeedbackTypeSection
              documentTypeId={documentTypeId || ''}
            />
          )}
          {activeTab === 'manage-prompt' && (
            <ManagePromptSection
              documentTypeName={documentType.name}
              documentTypeId={documentTypeId || ''}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsSection
              feedbackCategories={feedbackCategories}
            />
          )}
        </div>
      </div>
    </div>
  );
}
